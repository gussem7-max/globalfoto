// =====================================================
// VERIFICACIÓN POR SELFIE (face-api.js)
// Todo el procesamiento ocurre EN EL DISPOSITIVO del cliente.
// =====================================================

let pendingGalleryPhotos = [];
let selfieStream = null;
let selfieDescriptor = null;

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const MATCH_THRESHOLD = 0.65; // más permisivo (encuentra más, pero puede haber falsos positivos)
const SELFIE_MAX_DIM = 640;

function el(id) { return document.getElementById(id); }
function setStatus(text) { el('selfieStatus').textContent = text; }
function setProgress(text) { el('selfieProgress').textContent = text; }

function showSelfieGate() { el('selfieGate').classList.remove('hidden'); }

function hideSelfieGate() {
    el('selfieGate').classList.add('hidden');
    stopCamera();
}

async function loadFaceModels() {
    if (window.__faceModelsLoaded) return;
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    window.__faceModelsLoaded = true;
}

async function startCamera() {
    const video = el('selfieVideo');
    try {
        setStatus('Solicitando permiso de cámara...');
        selfieStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = selfieStream;
        await video.play();
        video.classList.remove('hidden');
        el('btnStartCamera').classList.add('hidden');
        el('btnCapture').classList.remove('hidden');
        setStatus('Centra tu rostro y toma la selfie.');
    } catch (err) {
        console.error('Error de cámara:', err);
        setStatus('No pudimos acceder a la cámara. Usa la opción de subir una foto.');
        el('selfieFileFallback').classList.remove('hidden');
    }
}

function stopCamera() {
    if (selfieStream) { selfieStream.getTracks().forEach(t => t.stop()); selfieStream = null; }
}

function drawResizedToCanvas(source, sourceWidth, sourceHeight) {
    const canvas = el('selfieCanvas');
    const scale = Math.min(1, SELFIE_MAX_DIM / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function showSelfieReady() {
    const preview = el('selfiePreview');
    preview.src = el('selfieCanvas').toDataURL('image/jpeg', 0.9);
    preview.classList.remove('hidden');
    el('selfieVideo').classList.add('hidden');
    el('btnStartCamera').classList.add('hidden');
    el('btnCapture').classList.add('hidden');
    el('btnRetake').classList.remove('hidden');
    el('btnVerify').classList.remove('hidden');
    el('btnVerify').disabled = false;
    setStatus('Selfie lista. Presiona "Verificar y ver mis fotos".');
}

function captureSelfie() {
    const video = el('selfieVideo');
    drawResizedToCanvas(video, video.videoWidth, video.videoHeight);
    stopCamera();
    showSelfieReady();
}

function retakeSelfie() {
    el('selfiePreview').classList.add('hidden');
    el('btnVerify').classList.add('hidden');
    el('btnRetake').classList.add('hidden');
    el('btnCapture').classList.remove('hidden');
    setStatus('');
    setProgress('');
    startCamera();
}

function onSelfieFileChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        drawResizedToCanvas(img, img.width, img.height);
        URL.revokeObjectURL(url);
        showSelfieReady();
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus('No se pudo leer la imagen. Prueba con otro archivo.');
    };
    img.src = url;
}

async function detectFaces(sourceEl) {
    return await faceapi
        .detectAllFaces(sourceEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
}

async function verifySelfie() {
    const btn = el('btnVerify');
    setStatus('Preparando verificación...');
    setProgress('');
    btn.disabled = true;
    try {
        if (typeof faceapi === 'undefined') {
            setStatus('⚠️ El motor de reconocimiento (face-api) no se cargó. Revisa tu conexión o la configuración de seguridad (CSP) del servidor.');
            btn.disabled = false;
            return;
        }

        setStatus('Cargando modelos de reconocimiento facial...');
        try {
            await loadFaceModels();
        } catch (m) {
            console.error('Error cargando modelos:', m);
            setStatus('⚠️ No se pudieron descargar los modelos de reconocimiento. Detalle: ' + (m.message || m));
            btn.disabled = false;
            return;
        }

        let selfieDets;
        try {
            selfieDets = await detectFaces(el('selfieCanvas'));
        } catch (d) {
            console.error('Error procesando selfie:', d);
            setStatus('⚠️ Error al procesar tu selfie. Detalle: ' + (d.message || d));
            btn.disabled = false;
            return;
        }
        if (!selfieDets || selfieDets.length === 0) {
            setStatus('No se detectó un rostro en tu selfie. Intenta con mejor iluminación, mirando de frente y sin taparte la cara.');
            btn.disabled = false;
            return;
        }
        selfieDescriptor = selfieDets[0].descriptor;

        const total = pendingGalleryPhotos.length;
        const matched = [];
        let failed = 0;
        let totalFaces = 0;
        let bestDistance = Infinity;

        for (let i = 0; i < total; i++) {
            setProgress(`Analizando foto ${i + 1} de ${total}...`);
            const p = pendingGalleryPhotos[i];
            try {
                const img = await faceapi.fetchImage(p.url);
                const dets = await detectFaces(img);
                totalFaces += dets.length;
                let photoMatch = false;
                for (const d of dets) {
                    const dist = faceapi.euclideanDistance(selfieDescriptor, d.descriptor);
                    if (dist < bestDistance) bestDistance = dist;
                    if (dist < MATCH_THRESHOLD) photoMatch = true;
                }
                if (photoMatch) matched.push(p);
            } catch (photoErr) {
                failed++;
                console.warn('No se pudo analizar la foto', p.id, photoErr);
            }
        }
        setProgress('');

        if (total > 0 && failed === total) {
            setStatus('⚠️ No se pudieron descargar las fotos de la galería para analizarlas. Esto suele deberse a que falta configurar CORS en el bucket de S3.');
            btn.disabled = false;
            return;
        }

        if (matched.length === 0) {
            const distText = bestDistance === Infinity ? 'n/a' : bestDistance.toFixed(2);
            setStatus(`No encontramos fotos tuyas en esta galería. [Diagnóstico: rostros detectados=${totalFaces}, mejor distancia=${distText}, umbral=${MATCH_THRESHOLD}] Si crees que es un error, intenta con otra selfie o contacta al fotógrafo.`);
            btn.disabled = false;
            return;
        }

        try {
            hideSelfieGate();
            revealGallery(matched);
        } catch (r) {
            console.error('Error al mostrar galería:', r);
            setStatus('⚠️ Error al mostrar tus fotos. Detalle: ' + (r.message || r));
            btn.disabled = false;
            return;
        }
    } catch (err) {
        console.error('Error general de verificación:', err);
        setProgress('');
        setStatus('⚠️ Ocurrió un error durante la verificación. Detalle: ' + (err && err.message ? err.message : err));
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const bStart = el('btnStartCamera');
    const bCap = el('btnCapture');
    const bRet = el('btnRetake');
    const bVer = el('btnVerify');
    const fileInput = el('selfieFileFallbackInput');
    if (bStart) bStart.addEventListener('click', startCamera);
    if (bCap) bCap.addEventListener('click', captureSelfie);
    if (bRet) bRet.addEventListener('click', retakeSelfie);
    if (bVer) bVer.addEventListener('click', verifySelfie);
    if (fileInput) fileInput.addEventListener('change', onSelfieFileChosen);
});