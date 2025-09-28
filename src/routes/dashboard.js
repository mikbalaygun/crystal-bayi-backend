const express = require('express');
const router = express.Router();

const soapService = require('../services/soapService');
const FavoriteProduct = require('../models/FavoriteProduct');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// ===============================
// GET /api/dashboard/stats
// Get dashboard statistics
// ===============================
router.get('/stats', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  logger.request(req, `Fetching dashboard stats for user: ${userHesap}`);

  try {
    // Initialize default stats
    let stats = {
      waitingOrders: 0,
      waitingOrdersPrice: 0,
      totalFavorites: 0,
      recentOrdersCount: 0,
      accountBalance: parseFloat(req.user.bakiye) || 0
    };

    // Get waiting orders from SOAP
    try {
      const orders = await soapService.getOrders(userHesap);
      
      if (orders && orders.length > 0) {
        stats.waitingOrders = orders.length;
        stats.waitingOrdersPrice = orders.reduce((total, order) => {
          return total + (parseFloat(order.siptut) || 0);
        }, 0);
        
        // Count recent orders (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        stats.recentOrdersCount = orders.filter(order => {
          if (order.tarih) {
            try {
              // Assuming date format is DD-MM-YYYY or similar
              const orderDate = new Date(order.tarih);
              return orderDate >= sevenDaysAgo;
            } catch (dateError) {
              return false;
            }
          }
          return false;
        }).length;
      }
    } catch (soapError) {
      logger.warn('SOAP service error for orders - using default values', {
        userHesap,
        error: soapError.message,
        requestId: req.id
      });
    }

    // Get favorites count from MongoDB
    try {
      stats.totalFavorites = await FavoriteProduct.countDocuments({
        userHesap,
        isActive: true
      });
    } catch (dbError) {
      logger.warn('Database error for favorites - using default value', {
        userHesap,
        error: dbError.message,
        requestId: req.id
      });
    }

    logger.info('Dashboard stats fetched successfully', {
      userHesap,
      stats,
      requestId: req.id
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Failed to fetch dashboard stats:', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    // Return default stats on error to keep dashboard functional
    res.json({
      success: true,
      data: {
        waitingOrders: 0,
        waitingOrdersPrice: 0,
        totalFavorites: 0,
        recentOrdersCount: 0,
        accountBalance: parseFloat(req.user.bakiye) || 0
      }
    });
  }
}));

// ===============================
// GET /api/dashboard/recent-orders
// Get recent orders for dashboard
// ===============================
router.get('/recent-orders', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const limit = parseInt(req.query.limit) || 5;

  logger.request(req, `Fetching recent orders for dashboard: ${userHesap}`);

  try {
    const allOrders = await soapService.getOrders(userHesap);
    
    // Sort by date (most recent first) and limit
    const recentOrders = allOrders
      .sort((a, b) => {
        try {
          const dateA = new Date(a.tarih);
          const dateB = new Date(b.tarih);
          return dateB - dateA;
        } catch (error) {
          return 0;
        }
      })
      .slice(0, limit)
      .map(order => ({
        sipno: order.sipno,
        tarih: order.tarih,
        mlzadi: order.mlzadi,
        siptut: parseFloat(order.siptut) || 0,
        sipbak: parseFloat(order.sipbak) || 0
      }));

    logger.info('Recent orders fetched successfully', {
      userHesap,
      orderCount: recentOrders.length,
      requestId: req.id
    });

    res.json({
      success: true,
      data: recentOrders
    });

  } catch (error) {
    logger.error('Failed to fetch recent orders:', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    // Return empty array on error
    res.json({
      success: true,
      data: []
    });
  }
}));

// ===============================
// GET /api/dashboard/recent-favorites
// Get recently added favorite products
// ===============================
router.get('/recent-favorites', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const limit = parseInt(req.query.limit) || 5;

  logger.request(req, `Fetching recent favorites for dashboard: ${userHesap}`);

  try {
    const recentFavorites = await FavoriteProduct.find({
      userHesap,
      isActive: true
    })
    .sort({ addedAt: -1 })
    .limit(limit)
    .select('stkno stokadi fiyat addedAt')
    .lean();

    logger.info('Recent favorites fetched successfully', {
      userHesap,
      favoriteCount: recentFavorites.length,
      requestId: req.id
    });

    res.json({
      success: true,
      data: recentFavorites
    });

  } catch (error) {
    logger.error('Failed to fetch recent favorites:', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    res.json({
      success: true,
      data: []
    });
  }
}));

// ===============================
// GET /api/dashboard/account-info
// Get account information summary
// ===============================
router.get('/account-info', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;

  logger.request(req, `Fetching account info for user: ${user.hesap}`);

  try {
    const accountInfo = {
      company: user.company || '',
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      bakiye: parseFloat(user.bakiye) || 0,
      adres: user.adres || '',
      sehir: user.sehir || '',
      ulke: user.ulke || '',
      type: user.type || 'customer'
    };

    logger.info('Account info fetched successfully', {
      userHesap: user.hesap,
      requestId: req.id
    });

    res.json({
      success: true,
      data: accountInfo
    });

  } catch (error) {
    logger.error('Failed to fetch account info:', {
      userHesap: user.hesap,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('Failed to fetch account information', 500);
  }
}));

// ===============================
// GET /api/dashboard/health
// Dashboard health check
// ===============================
router.get('/health', catchAsync(async (req, res) => {
  try {
    // Check SOAP service health
    const soapHealth = await soapService.healthCheck();
    
    // Check MongoDB health
    const FavoriteProduct = require('../models/FavoriteProduct');
    const dbHealth = { status: 'OK' };
    
    try {
      await FavoriteProduct.findOne().limit(1);
    } catch (dbError) {
      dbHealth.status = 'ERROR';
      dbHealth.error = dbError.message;
    }

    res.json({
      success: true,
      dashboard: 'OK',
      soap: soapHealth,
      database: dbHealth,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.json({
      success: false,
      dashboard: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

module.exports = router;