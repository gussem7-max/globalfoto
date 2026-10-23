const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./src/db');

const app = express();
const PORT = process.env.PORT || 4000;

// Render funciona detrás de un proxy HTTPS: necesario para IPs y rate-limit correctos
app.set('trust proxy', 1);

// ---------------------------------------------------------------
// 1) CABECERAS DE SEGURIDAD (HSTS, anti-sniffing, anti-clickjacking)
// ---------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Permite onclick, onsubmit, onchange inline
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ---------------------------------------------------------------
// 2) CORS CON LISTA BLANCA DE ORÍGENES (solo tu dominio)
// ---------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4000,http://127.0.0.1:4000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Peticiones sin origin (mismo origen, Postman, curl) pasan siempre
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Bloqueado por política CORS'));
  },
  credentials: true
}));

// Límite de tamaño en payloads JSON (anti DoS)
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------
// 3) RATE LIMITING (anti fuerza bruta y abuso del API)
// ---------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 500,               // máx. 500 peticiones generales por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en unos minutos.' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,                // máx. 20 intentos de login/registro por IP cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Archivos estáticos del cliente web
app.use(express.static('public'));

// AUTO-CREAR COLUMNA FALTANTE (temporal; en Fase B lo migraremos a /migrations)
pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS photographer_id INTEGER;`)
  .then(() => console.log('✔ Columna photographer_id verificada/creada exitosamente.'))
  .catch(err => console.error('✖ Error al verificar columna en la base de datos:', err));

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ mensaje: '¡Bienvenido al backend de GlobalFoto funcionando al 100%!' });
});

// ---------------------------------------------------------------
// RUTAS DE LA API
// ---------------------------------------------------------------
const authRoutes = require('./src/routes/auth');
app.use('/api/auth', authRoutes);

const eventRoutes = require('./src/routes/events');
app.use('/api/events', eventRoutes);

const photoRoutes = require('./src/routes/photos');
app.use('/api/photos', photoRoutes);

// Subidas locales (legacy): en producción las fotos viven en S3
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------------------------------------------------
// 4) 404 Y MANEJADOR CENTRAL DE ERRORES (sin fugas de información)
// ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('ERROR:', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Error interno del servidor.' : err.message
  });
});

// ---------------------------------------------------------------
// 5) ARRANQUE Y APAGADO GRACEFUL (estabilidad en Render)
// ---------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo exitosamente en el puerto ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM recibido: cerrando servidor con elegancia...');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
});