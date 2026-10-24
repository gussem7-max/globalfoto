// =====================================================
// VERIFICACIÓN POR SELFIE (face-api.js)
// Todo el procesamiento ocurre EN EL DISPOSITIVO del cliente.
// La selfie y los datos biométricos NUNCA se suben al servidor.
// =====================================================

let pendingGalleryPhotos = [];
let selfieStream = null;
let selfieDescriptor = null;

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const MATCH_THRESHOLD = 0.6; // distancia euclidiana; menor = mismo rostro

function showSelfieGate() {
    document.getElementById('selfieGate').classList.remove('hidden');
}

function hideSelfieGate() {
    document.getElementById('selfieGate').classList.add('hidden');
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
    const video = document.getElementById('selfieVideo');
    const status = document.getElementById('selfieStatus');
    try {
        status.textContent = 'Solicitando permiso de cámara...';
        selfieStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = selfieStream;
        await video.play();
        video.classList.remove('hidden');
        document.getElementById('btnStartCamera').classList.add('hidden');
        document.getElementById('btnCapture').classList.remove('hidden');
        status.textContent = 'Centra tu rostro y toma la selfie.';
    } catch (err) {
        console.error('Error de cámara:', err);
        status.textContent = 'No pudimos acceder a la cámara. Usa la opción de subir una foto.';
        document.getElementById('selfieFileFallback').classList.remove('hidden');
    }
}

function stopCamera() {
    if (selfieStream) { selfieStream.getTracks().forEach(t => t.stop()); selfieStream = null; }
}

function captureSelfie() {
    const video = document.getElementById('selfieVideo');
    const canvas = document.getElementById('selfieCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopCamera();
    video.classList.add('hidden');
    const preview = document.getElementById('selfiePreview');
    preview.src = canvas.toDataURL('image/jpeg');
    preview.classList.remove('hidden');
    document.getElementById('btnCapture').classList.add('hidden');
    document.getElementById('btnRetake').classList.remove('hidden');
    document.getElementById('btnVerify').classList.remove('hidden');
    document.getElementById('selfieStatus').textContent = 'Selfie lista. Presiona "Verificar y ver mis fotos".';
}

function retakeSelfie() {
    document.getElementById('selfiePreview').classList.add('hidden');
    document.getElementById('btnVerify').classList.add('hidden');
    document.getElementById('btnRetake').classList.add('hidden');
    document.getElementById('btnCapture').classList.remove('hidden');
    document.getElementById('selfieStatus').textContent = '';
    startCamera();
}

function onSelfieFileChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const preview = document.getElementById('selfiePreview');
        preview.src = ev.target.result;
        preview.classList.remove('hidden');
        document.getElementById('selfieVideo').classList.add('hidden');
        document.getElementById('btnCapture').classList.add('hidden');
        document.getElementById('btnStartCamera').classList.add('hidden');
        document.getElementById('btnRetake').classList.remove('hidden');
        document.getElementById('btnVerify').classList.remove('hidden');
        document.getElementById('selfieStatus').textContent = 'Foto lista. Presiona "Verificar y ver mis fotos".';
    };
    reader.readAsDataURL(file);
}

async function detectFaces(imgEl) {
    return await faceapi
        .detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
}

async function verifySelfie() {
    const status = document.getElementById('selfieStatus');
    const progress = document.getElementById('selfieProgress');
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    try {
        status.textContent = 'Cargando modelos de reconocimiento facial...';
        await loadFaceModels();

        const preview = document.getElementById('selfiePreview');
        const selfieImg = await faceapi.fetchImage(preview.src);
        const selfieDets = await detectFaces(selfieImg);
        if (selfieDets.length === 0) {
            status.textContent = 'No se detectó un rostro en tu selfie. Intenta de nuevo con mejor iluminación y mirando de frente.';
            btn.disabled = false;
            return;
        }
        selfieDescriptor = selfieDets[0].descriptor;

        const total = pendingGalleryPhotos.length;
        const matched = [];
        for (let i = 0; i < total; i++) {
            progress.textContent = `Analizando foto ${i + 1} de ${total}...`;
            const p = pendingGalleryPhotos[i];
            try {
                const img = await faceapi.fetchImage(p.url);
                const dets = await detectFaces(img);
                const isMatch = dets.some(d => faceapi.euclideanDistance(selfieDescriptor, d.descriptor) < MATCH_THRESHOLD);
                if (isMatch) matched.push(p);
            } catch (err) {
                console.warn('No se pudo analizar la foto', p.id, err);
            }
        }

        progress.textContent = '';
        if (matched.length === 0) {
            status.textContent = 'No encontramos fotos tuyas en esta galería. Si crees que es un error, vuelve a intentarlo con otra selfie o contacta al fotógrafo.';
            btn.disabled = false;
            return;
        }

        hideSelfieGate();
        revealGallery(matched);
    } catch (err) {
        console.error('Error en verificación:', err);
        progress.textContent = '';
        status.textContent = 'Ocurrió un error durante la verificación. Intenta de nuevo.';
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const bStart = document.getElementById('btnStartCamera');
    const bCap = document.getElementById('btnCapture');
    const bRet = document.getElementById('btnRetake');
    const bVer = document.getElementById('btnVerify');
    const fileInput = document.getElementById('selfieFileFallbackInput');
    if (bStart) bStart.addEventListener('click', startCamera);
    if (bCap) bCap.addEventListener('click', captureSelfie);
    if (bRet) bRet.addEventListener('click', retakeSelfie);
    if (bVer) bVer.addEventListener('click', verifySelfie);
    if (fileInput) fileInput.addEventListener('change', onSelfieFileChosen);
});