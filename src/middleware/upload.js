const multer = require('multer');
const path = require('path');

// Configuración de almacenamiento local
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Carpeta destino
    },
    filename: (req, file, cb) => {
        // Generar un nombre único usando el timestamp actual y el nombre original
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Filtro para aceptar solo archivos de imagen
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, etc.).'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB por foto
    fileFilter: fileFilter
});

module.exports = upload;