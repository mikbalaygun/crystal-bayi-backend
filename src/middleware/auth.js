const jwt = require('jsonwebtoken');
const { AppError, catchAsync } = require('./errorHandler');
const logger = require('../utils/logger');

// JWT token verification middleware
const authenticateToken = catchAsync(async (req, res, next) => {
  // Get token from header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('Authentication failed: No token provided', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.id
    });
    
    return next(new AppError('Access token required', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add user to request
    req.user = decoded;
    
    logger.auth('User authenticated successfully', decoded.hesap, {
      requestId: req.id,
      userType: decoded.type
    });
    
    next();
    
  } catch (error) {
    let message = 'Invalid token';
    let statusCode = 401;
    
    if (error.name === 'TokenExpiredError') {
      message = 'Token has expired';
      statusCode = 401;
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid token format';
      statusCode = 401;
    }
    
    logger.warn('Authentication failed:', {
      error: error.name,
      message: error.message,
      requestId: req.id,
      ip: req.ip
    });
    
    return next(new AppError(message, statusCode));
  }
});

// Check if user is admin
const requireAdmin = catchAsync(async (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  if (req.user.type !== 'admin' && req.user.hesap !== 'admin') {
    logger.warn('Admin access denied', req.user.hesap, {
      requestId: req.id,
      attemptedUrl: req.originalUrl
    });
    
    return next(new AppError('Admin access required', 403));
  }

  next();
});

// Optional authentication (for endpoints that work with or without auth)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    
    logger.auth('Optional auth successful', decoded.hesap, {
      requestId: req.id
    });
  } catch (error) {
    // For optional auth, we don't throw error on invalid token
    logger.warn('Optional auth failed - continuing without user', {
      error: error.name,
      requestId: req.id
    });
  }

  next();
};

// Rate limiting specifically for auth endpoints
const authLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs for auth
  message: {
    error: 'Too many authentication attempts',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Extract user info from token without requiring valid token
const extractUser = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Ignore token errors for extraction
    }
  }

  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth,
  authLimiter,
  extractUser
};