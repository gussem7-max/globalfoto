// =====================================================
// VERIFICACIÓN POR SELFIE (face-api.js)
// =====================================================

let pendingGalleryPhotos = [];
let selfieStream = null;
let selfieDescriptor = null;

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const MATCH_THRESHOLD = 0.6;
const SELFIE_MAX_DIM = 640;

function el(id) { return document.getElementById(id); }
function setStatus(text) { const e = el('selfieStatus'); if (e) e.textContent = text; }
function setProgress(text) { const e = el('selfieProgress'); if (e) e.textContent = text; }

function showSelfieGate() { const e = el('selfieGate'); if (e) e.classList.remove('hidden'); }
function hideSelfieGate() { const e = el('selfieGate'); if (e) e.classList.add('hidden'); stopCamera(); }

async function loadFaceModels() {
    if (window.__faceModelsLoaded) return;
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    window.__faceModelsLoaded = true;
}

async function startCamera() {
    const video = el('selfieVideo');
    const container = el('selfieCameraContainer');
    const guideText = el('selfieGuideText');
    try {
        setStatus('Solicitando permiso de cámara...');
        selfieStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = selfieStream;
        await video.play();
        if (container) container.style.display = 'block';
        if (guideText) guideText.classList.remove('hidden');
        const btn = el('btnStartCamera'); if (btn) btn.classList.add('hidden');
        const cap = el('btnCapture'); if (cap) cap.classList.remove('hidden');
        setStatus('Centra tu rostro en el óvalo y toma la selfie.');
    } catch (err) {
        console.error('Error de cámara:', err);
        setStatus('No pudimos acceder a la cámara. Usa la opción de subir una foto.');
        const fb = el('selfieFileFallback'); if (fb) fb.classList.remove('hidden');
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
    const container = el('selfieCameraContainer');
    const guideText = el('selfieGuideText');
    if (preview) { preview.src = el('selfieCanvas').toDataURL('image/jpeg', 0.9); preview.classList.remove('hidden'); preview.style.display = 'block'; }
    if (container) container.style.display = 'none';
    if (guideText) guideText.classList.add('hidden');
    const btnStart = el('btnStartCamera'); if (btnStart) btnStart.classList.add('hidden');
    const btnCap = el('btnCapture'); if (btnCap) btnCap.classList.add('hidden');
    const btnRet = el('btnRetake'); if (btnRet) btnRet.classList.remove('hidden');
    const btnVer = el('btnVerify'); if (btnVer) { btnVer.classList.remove('hidden'); btnVer.disabled = false; }
    setStatus('Selfie lista. Presiona "Verificar y ver mis fotos".');
}

function captureSelfie() {
    const video = el('selfieVideo');
    drawResizedToCanvas(video, video.videoWidth, video.videoHeight);
    stopCamera();
    showSelfieReady();
}

function retakeSelfie() {
    const preview = el('selfiePreview');
    if (preview) { preview.classList.add('hidden'); preview.style.display = 'none'; }
    const btnVer = el('btnVerify'); if (btnVer) btnVer.classList.add('hidden');
    const btnRet = el('btnRetake'); if (btnRet) btnRet.classList.add('hidden');
    const btnCap = el('btnCapture'); if (btnCap) btnCap.classList.remove('hidden');
    setStatus(''); setProgress(''); startCamera();
}

function onSelfieFileChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { drawResizedToCanvas(img, img.width, img.height); URL.revokeObjectURL(url); showSelfieReady(); };
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('No se pudo leer la imagen.'); };
    img.src = url;
}

async function detectFaces(sourceEl) {
    return await faceapi.detectAllFaces(sourceEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptors();
}

async function verifySelfie() {
    const btn = el('btnVerify');
    setStatus('Preparando verificación...');
    setProgress('');
    if (btn) btn.disabled = true;
    try {
        if (typeof faceapi === 'undefined') { setStatus('⚠️ El motor de reconocimiento no se cargó.'); if (btn) btn.disabled = false; return; }

        setStatus('Cargando modelos...');
        try { await loadFaceModels(); } catch (m) { setStatus('️ No se pudieron descargar los modelos.'); if (btn) btn.disabled = false; return; }

        let selfieDets;
        try { selfieDets = await detectFaces(el('selfieCanvas')); } catch (d) { setStatus('⚠️ Error al procesar tu selfie.'); if (btn) btn.disabled = false; return; }
        if (!selfieDets || selfieDets.length === 0) { setStatus('No se detectó un rostro. Intenta con mejor iluminación.'); if (btn) btn.disabled = false; return; }
        selfieDescriptor = selfieDets[0].descriptor;

        // ⚠️ IMPORTANTE: usa pubCurrentPhotos (de public.js) en vez de currentPhotos
        const photosToScan = (typeof pubCurrentPhotos !== 'undefined' && pubCurrentPhotos.length > 0) ? pubCurrentPhotos : currentPhotos;
        const total = photosToScan.length;
        const matched = [];
        let failed = 0, totalFaces = 0, bestDistance = Infinity;

        for (let i = 0; i < total; i++) {
            setProgress(`Analizando foto ${i + 1} de ${total}...`);
            const p = photosToScan[i];
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
            } catch (photoErr) { failed++; }
        }
        setProgress('');

        if (total > 0 && failed === total) { setStatus('⚠️ No se pudieron descargar las fotos (CORS en S3).'); if (btn) btn.disabled = false; return; }
        if (matched.length === 0) { setStatus(`No encontramos fotos tuyas. [rostros=${totalFaces}, distancia=${bestDistance.toFixed(2)}, umbral=${MATCH_THRESHOLD}]`); if (btn) btn.disabled = false; return; }

        hideSelfieGate();
        if (typeof revealGallery === 'function') revealGallery(matched);
    } catch (err) {
        setProgress('');
        setStatus('⚠️ Error: ' + (err.message || err));
        if (btn) btn.disabled = false;
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