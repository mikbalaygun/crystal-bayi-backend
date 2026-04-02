// src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const morgan = require('morgan');
require('dotenv').config();

const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const favoriteRoutes = require('./routes/favorites');
const dashboardRoutes = require('./routes/dashboard');
const extractRoutes = require('./routes/extract');
const contactRoutes = require('./routes/contact');
const cartRoutes = require('./routes/cart');

const app = express();
const PORT = process.env.PORT || 3300;

/* -----------------------------
 * SECURITY & MIDDLEWARE
 * --------------------------- */

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,       // SOAP istekleri için kapalı
  crossOriginEmbedderPolicy: false
}));

// CORS (çoklu origin desteği)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  optionsSuccessStatus: 204
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10),
  message: { error: 'Too many requests from this IP', retryAfter: '15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);
app.set('trust proxy', process.env.TRUST_PROXY === 'true');

// Body parsing
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// HTTP request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) }
  }));
}

// Request ID
app.use((req, res, next) => {
  req.id = require('uuid').v4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

/* -----------------------------
 * DATABASE
 * --------------------------- */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000,  // 5000'den 30000'e değişti
      socketTimeoutMS: 45000,
    });
    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => logger.error('MongoDB connection error:', err));
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

/* -----------------------------
 * ROUTES
 * --------------------------- */

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION || '2.0.0'
  });
});

// API
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/cart', cartRoutes);

// 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler (en sonda)
app.use(errorHandler);

/* -----------------------------
 * SHUTDOWN SIGNALS
 * --------------------------- */
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

/* -----------------------------
 * START SERVER + CRON
 * --------------------------- */
const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Crystal Bayi Backend running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Frontend URL(s): ${allowedOrigins.join(', ')}`);
    });

    // >>> Cron'ları burada başlat <
    const { scheduleProductSync, scheduleImageSync } = require('./cron');
    scheduleProductSync(); // ENABLE_PRODUCT_CRON=true ise aktif
    scheduleImageSync(); // ENABLE_IMAGE_CRON=true ise aktif

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') logger.error(`❌ Port ${PORT} is already in use`);
      else logger.error('❌ Server error:', error);
      process.exit(1);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
