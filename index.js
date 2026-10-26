const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./src/db');

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "https://images.unsplash.com"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://*.amazonaws.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4000,http://127.0.0.1:4000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Bloqueado por política CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en unos minutos.' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ========== RUTAS DE PÁGINAS ==========

// Landing page (raíz)
app.get('/', (req, res) => {
  if (req.query.galeria) {
    return res.redirect(301, `/g/${req.query.galeria}`);
  }
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Panel (login / registro / dashboard)
app.get('/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Galería pública por ID
app.get('/g/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Galería pública por CÓDIGO de evento (redirige al ID)
app.get('/e/:code', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id FROM events WHERE UPPER(event_code) = UPPER($1)',
      [req.params.code]
    );
    if (result.rows.length === 0) {
      return res.redirect(302, '/?error=codigo');
    }
    res.redirect(301, `/g/${result.rows[0].id}`);
  } catch (error) {
    console.error('Error resolviendo código de evento:', error);
    res.redirect(302, '/?error=codigo');
  }
});

// Archivos estáticos
app.use(express.static('public'));

pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS photographer_id INTEGER;`)
  .then(() => console.log('✔ Columna photographer_id verificada/creada exitosamente.'))
  .catch(err => console.error('✖ Error al verificar columna en la base de datos:', err));

// ========== RUTAS DE LA API ==========

const authRoutes = require('./src/routes/auth');
app.use('/api/auth', authRoutes);
app.use('/api/subscriptions', require('./routes/subscriptions'));

const eventRoutes = require('./src/routes/events');
app.use('/api/events', eventRoutes);

const photoRoutes = require('./src/routes/photos');
app.use('/api/photos', photoRoutes);

const orderRoutes = require('./src/routes/orders');
app.use('/api/orders', orderRoutes);

const usersRoutes = require('./src/routes/users');
app.use('/api/users', usersRoutes);

const adminRoutes = require('./src/routes/admin');
app.use('/api/admin', adminRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
  console.error('ERROR:', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Error interno del servidor.' : err.message
  });
});

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