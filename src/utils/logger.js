const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Circular reference safe JSON stringify
const safeStringify = (obj, indent = 2) => {
  try {
    return JSON.stringify(obj, (key, value) => {
      // Handle Error objects
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      
      // Handle circular reference prone objects
      if (typeof value === 'object' && value !== null) {
        if (value.constructor && ['Socket', 'ClientRequest', 'TLSSocket', 'IncomingMessage'].includes(value.constructor.name)) {
          return '[Object]';
        }
        
        // Handle other potential circular objects
        if (value._httpMessage || value.socket || value.connection) {
          return '[Circular Object]';
        }
      }
      
      return value;
    }, indent);
  } catch (error) {
    return `[Stringify Error: ${error.message}]`;
  }
};

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'crystal-bayi-backend',
    version: process.env.APP_VERSION || '2.0.0'
  },
  transports: [
    // Write errors to error.log
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Write all logs to combined.log
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Console logging for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaStr = '';
        if (Object.keys(meta).length) {
          metaStr = ` ${safeStringify(meta)}`;
        }
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    )
  }));
}

// Helper methods
logger.request = (req, message = 'Request received') => {
  logger.info(message, {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
};

logger.soap = (operation, data) => {
  logger.info(`SOAP Operation: ${operation}`, {
    operation,
    requestData: safeStringify(data) // SOAP data'yı güvenli stringify et
  });
};

logger.auth = (message, userId, additional = {}) => {
  logger.info(message, {
    userId,
    ...additional
  });
};

// SOAP error için özel method
logger.soapError = (operation, error, params = {}) => {
  logger.error(`SOAP ${operation} failed`, {
    operation,
    error: error.message || error,
    params: safeStringify(params),
    stack: error.stack
  });
};

module.exports = logger;