const logger = require('../utils/logger');

// Custom error class for application-specific errors
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle different types of errors
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

const handleSOAPError = (err) => {
  logger.error('SOAP Error:', err);
  return new AppError('External service error. Please try again later.', 503);
};

// Send error response in development
const sendErrorDev = (err, req, res) => {
  logger.error('Error in development:', {
    error: err,
    requestId: req.id,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });

  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack,
    requestId: req.id
  });
};

// Send error response in production
const sendErrorProd = (err, req, res) => {
  // Log error details
  logger.error('Production error:', {
    message: err.message,
    statusCode: err.statusCode,
    requestId: req.id,
    url: req.originalUrl,
    method: req.method,
    isOperational: err.isOperational
  });

  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      requestId: req.id
    });
  } else {
    // Programming or unknown error: don't leak error details
    res.status(500).json({
      success: false,
      message: 'Something went wrong!',
      requestId: req.id
    });
  }
};

// Main error handling middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') error = handleCastErrorDB(error);

  // Mongoose duplicate key
  if (err.code === 11000) error = handleDuplicateFieldsDB(error);

  // Mongoose validation error
  if (err.name === 'ValidationError') error = handleValidationErrorDB(error);

  // JWT errors
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  // SOAP errors
  if (err.message && err.message.includes('SOAP')) error = handleSOAPError(error);

  // Send error response
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, req, res);
  } else {
    sendErrorProd(error, req, res);
  }
};

// Async error wrapper to catch async errors in route handlers
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

module.exports = {
  errorHandler,
  AppError,
  catchAsync
};