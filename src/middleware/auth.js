const jwt = require('jsonwebtoken');

// Usamos la misma clave secreta estandarizada para toda la aplicación
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_globalfoto_2026';

const verificarToken = (req, res, next) => {
    // Buscar el token en las cabeceras de la petición (Authorization: Bearer <token>)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. No se proporcionó un token de autenticación.' });
    }

    try {
        // Verificar y decodificar el token
        const verified = jwt.verify(token, JWT_SECRET);
        
        // Asignar los datos del usuario a ambas propiedades para garantizar compatibilidad completa
        req.user = verified;
        req.usuario = verified;
        
        next(); // Continuar con la ruta
    } catch (error) {
        res.status(403).json({ error: 'El token es inválido o ha expirado.' });
    }
};

module.exports = verificarToken;