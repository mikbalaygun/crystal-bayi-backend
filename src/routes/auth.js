const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const soapService = require('../services/soapService');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authLimiter, authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Validation middleware
const validateLogin = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Username must be between 2-50 characters'),
    
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 3, max: 100 })
    .withMessage('Password must be between 3-100 characters')
];

// Helper function to generate JWT token
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// ===============================
// POST /api/auth/login
// ===============================
router.post('/login', authLimiter, validateLogin, catchAsync(async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Login validation failed', {
      errors: errors.array(),
      ip: req.ip,
      requestId: req.id
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, password } = req.body;

  logger.request(req, `Login attempt for username: ${username}`);

  // Check for admin credentials first (hardcoded as in original)
  if (username.toLowerCase() === 'admin' && password === '123123123') {
    const adminPayload = {
      company: 'admin',
      list: 'admin',
      username: 'admin',
      hesap: 'admin',
      type: 'admin'
    };

    const token = generateToken(adminPayload);

    logger.auth('Admin login successful', 'admin', {
      requestId: req.id,
      ip: req.ip
    });

    return res.json({
      success: true,
      message: 'Login successful',
      token: `Bearer ${token}`,
      user: {
        username: adminPayload.username,
        type: adminPayload.type,
        company: adminPayload.company
      }
    });
  }

  try {
    // Authenticate via SOAP service
    const authResult = await soapService.authenticateUser(username, password);
    
    if (!authResult.success) {
      logger.warn('SOAP authentication failed', {
        username,
        requestId: req.id,
        ip: req.ip
      });
      
      throw new AppError('Invalid credentials', 401);
    }

    const userPayload = authResult.user;
    const token = generateToken(userPayload);

    logger.auth('Customer login successful', username, {
      requestId: req.id,
      company: userPayload.company,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Login successful',
      token: `Bearer ${token}`,
      user: {
        username: userPayload.username,
        type: userPayload.type,
        company: userPayload.company,
        email: userPayload.email,
        list: userPayload.list,
        phone: userPayload.phone,
        bakiye: userPayload.bakiye
      }
    });

  } catch (error) {
    logger.error('Login error:', {
      username,
      error: error.message,
      requestId: req.id,
      ip: req.ip
    });

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Authentication service unavailable', 503);
  }
}));

// ===============================
// POST /api/auth/refresh
// ===============================
router.post('/refresh', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;
  
  // Generate new token with same payload but fresh expiration
  const newToken = generateToken(user);
  
  logger.auth('Token refreshed', user.hesap, {
    requestId: req.id,
    type: user.type
  });

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    token: `Bearer ${newToken}`
  });
}));

// ===============================
// GET /api/auth/me
// ===============================
router.get('/me', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;
  
  logger.auth('Profile info requested', user.hesap, {
    requestId: req.id
  });

  res.json({
    success: true,
    user: {
      username: user.username,
      type: user.type,
      company: user.company,
      hesap: user.hesap,
      email: user.email || '',
      phone: user.phone || '',
      bakiye: user.bakiye || '0',
      adres: user.adres || '',
      sehir: user.sehir || '',
      ulke: user.ulke || ''
    }
  });
}));

// ===============================
// POST /api/auth/logout
// ===============================
router.post('/logout', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;
  
  logger.auth('User logged out', user.hesap, {
    requestId: req.id
  });

  // Note: With JWT, we can't actually invalidate the token on server-side
  // The frontend should remove the token from storage
  // In a production app, you might want to maintain a blacklist of tokens
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// ===============================
// GET /api/auth/health
// ===============================
router.get('/health', catchAsync(async (req, res) => {
  try {
    const soapHealth = await soapService.healthCheck();
    
    res.json({
      success: true,
      auth: 'OK',
      soap: soapHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      success: false,
      auth: 'OK',
      soap: { status: 'ERROR', error: error.message },
      timestamp: new Date().toISOString()
    });
  }
}));

module.exports = router;