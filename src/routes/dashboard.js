const express = require('express');
const router = express.Router();

const soapService = require('../services/soapService');
const FavoriteProduct = require('../models/FavoriteProduct');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  logger.request(req, `Fetching dashboard stats for user: ${userHesap}`);

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
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      stats.recentOrdersCount = orders.filter(order => {
        if (order.tarih) {
          try {
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

  // Get favorites count - user field kullan, isActive yok
  try {
    stats.totalFavorites = await FavoriteProduct.countDocuments({
      user: userHesap
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
}));

// GET /api/dashboard/recent-orders
router.get('/recent-orders', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const limit = parseInt(req.query.limit) || 5;

  logger.request(req, `Fetching recent orders for dashboard: ${userHesap}`);

  try {
    const allOrders = await soapService.getOrders(userHesap);
    
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

    res.json({
      success: true,
      data: []
    });
  }
}));

// GET /api/dashboard/recent-favorites
router.get('/recent-favorites', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const limit = parseInt(req.query.limit) || 5;

  logger.request(req, `Fetching recent favorites for dashboard: ${userHesap}`);

  try {
    // user field kullan, isActive ve addedAt yok, createdAt kullan
    const recentFavorites = await FavoriteProduct.find({
      user: userHesap
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('stkno stokadi fiyat createdAt')
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

// GET /api/dashboard/account-info
router.get('/account-info', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;

  logger.request(req, `Fetching account info for user: ${user.hesap}`);

  const accountInfo = {
    company: user.company || '',
    username: user.username || '',
    email: user.email || '',
    phone: user.phone || '',
    bakiye: parseFloat(user.bakiye) || 0,
    adres: user.adres || '',
    sehir: user.sehir || '',
    ulke: user.ulke || '',
    type: user.type || 'customer',
    priceList: user.list || 1 // Fiyat listesi bilgisi
  };

  logger.info('Account info fetched successfully', {
    userHesap: user.hesap,
    priceList: user.list,
    requestId: req.id
  });

  res.json({
    success: true,
    data: accountInfo
  });
}));

// GET /api/dashboard/health
router.get('/health', catchAsync(async (req, res) => {
  try {
    const soapHealth = await soapService.healthCheck();
    
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