const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del cliente web
app.use(express.static('public'));

// Ruta de prueba
app.get('/', (req, res) => {
    res.json({ mensaje: '¡Bienvenido al backend de GlobalFoto funcionando al 100%!' });
});

// Importar rutas de autenticación
const authRoutes = require('./src/routes/auth');

// Usar rutas
app.use('/api/auth', authRoutes);

// Importar rutas de eventos
const eventRoutes = require('./src/routes/events');

// Usar rutas de eventos
app.use('/api/events', eventRoutes);

const path = require('path');

// Permitir que Express sirva los archivos estáticos de la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Importar y usar rutas de fotos
const photoRoutes = require('./src/routes/photos');
app.use('/api/photos', photoRoutes);

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo exitosamente en el puerto ${PORT}`);
});