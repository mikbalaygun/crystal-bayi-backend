// routes/orders.js
const express = require('express');
const { body, validationResult, query } = require('express-validator');
const router = express.Router();

const soapService = require('../services/soapService');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// ---- Helpers -------------------------------------------------
function toNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function parseDDMMYYYY(str) {
  // "DD-MM-YYYY" -> Date | null
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [ , dd, mm, yyyy ] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

// ---- Validations --------------------------------------------
const validateCreateOrder = [
  body('products').isArray({ min: 1 }).withMessage('Products array is required and must contain at least one item'),
  body('products.*.stkno').trim().notEmpty().withMessage('Stock number is required for each product'),
  body('products.*.adet').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('products.*.fiyat').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('products.*.cinsi').optional().isString().withMessage('Currency must be a string'),
];

const validateDateFilters = [
  query('startDate').optional().matches(/^\d{2}-\d{2}-\d{4}$/).withMessage('Start date must be in DD-MM-YYYY format'),
  query('endDate').optional().matches(/^\d{2}-\d{2}-\d{4}$/).withMessage('End date must be in DD-MM-YYYY format'),
];

// ===============================
// GET /api/orders
// ===============================
router.get('/', authenticateToken, validateDateFilters, catchAsync(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid date format', errors: errors.array() });
  }

  const userHesap = req.user.hesap;
  const { startDate, endDate } = req.query;

  logger.request(req, `Fetching orders for user: ${userHesap}`);

  const dateFilters = {};
  if (startDate) dateFilters.startDate = startDate; // DD-MM-YYYY
  if (endDate)   dateFilters.endDate   = endDate;   // DD-MM-YYYY

  try {
    const orders = await soapService.getOrders(userHesap, dateFilters);

    const transformed = (orders || []).map((o) => ({
      ...o,
      sipbak: toNumber(o.sipbak),
      sipfyt: toNumber(o.sipfyt),
      siptut: toNumber(o.siptut),
      tarih: o.tarih || '',
      termin: o.termin || '',
      _tarihDate: parseDDMMYYYY(o.tarih), // sadece sıralama için
    }));

    // Tarihi parse edebildiysek tarihe göre yeni->eski sırala
    transformed.sort((a, b) => {
      const da = a._tarihDate?.getTime() ?? 0;
      const db = b._tarihDate?.getTime() ?? 0;
      return db - da;
    });

    transformed.forEach(t => delete t._tarihDate);

    logger.info('Orders fetched successfully', {
      userHesap,
      orderCount: transformed.length,
      dateFilters,
      requestId: req.id,
    });

    res.json({
      success: true,
      data: {
        orders: transformed,
        filters: dateFilters,
        count: transformed.length,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch orders:', { userHesap, error: error.message, requestId: req.id });
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to fetch orders', 500);
  }
}));

// ===============================
// POST /api/orders
// ===============================
router.post('/', authenticateToken, validateCreateOrder, catchAsync(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const userHesap = req.user.hesap;
  const { products } = req.body;

  logger.request(req, `Creating order for user: ${userHesap}, products: ${products.length}`);

  try {
    const validatedProducts = products.map((p, idx) => {
      if (!p.stkno || p.adet == null || p.fiyat == null) {
        throw new AppError(`Invalid product data at index ${idx}`, 400);
      }
      return {
        stkno: String(p.stkno).trim(),
        adet: toNumber(p.adet, 0),
        fiyat: toNumber(p.fiyat, 0),
        cinsi: p.cinsi || 'TL',
      };
    }).filter(p => p.adet > 0);

    if (validatedProducts.length === 0) {
      throw new AppError('No valid product lines', 400);
    }

    const total = validatedProducts.reduce((sum, p) => sum + p.adet * p.fiyat, 0);

    logger.info('Order validation completed', {
      userHesap,
      productCount: validatedProducts.length,
      orderTotal: total,
      requestId: req.id,
    });

    const orderResult = await soapService.createOrder(userHesap, validatedProducts);
    // soapService.createOrder -> { success: true, orderId: result[0]?.sipno || 'Generated', message: ... }

    logger.info('Order created successfully', {
      userHesap,
      orderId: orderResult.orderId,
      productCount: validatedProducts.length,
      orderTotal: total,
      requestId: req.id,
    });

    return res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        orderId: orderResult.orderId,
        products: validatedProducts,
        totalAmount: total,
        status: 'created',
      },
    });
  } catch (error) {
    logger.error('Failed to create order:', {
      userHesap,
      productCount: products?.length || 0,
      error: error.message,
      requestId: req.id,
    });
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to create order', 500);
  }
}));

// ===============================
// GET /api/orders/stats
// ===============================
router.get('/stats', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  logger.request(req, `Fetching order stats for user: ${userHesap}`);

  try {
    const orders = await soapService.getOrders(userHesap);

    const totalOrders = (orders || []).length;
    const totalAmount = (orders || []).reduce((sum, o) => sum + toNumber(o.siptut), 0);
    const averageOrderValue = totalOrders > 0 ? totalAmount / totalOrders : 0;

    const thirtyDaysAgo = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d;
    })();

    const recentOrdersCount = (orders || []).reduce((acc, o) => {
      const d = parseDDMMYYYY(o.tarih);
      return acc + (d && d >= thirtyDaysAgo ? 1 : 0);
    }, 0);

    const stats = { totalOrders, totalAmount, averageOrderValue, recentOrdersCount };

    logger.info('Order stats calculated successfully', { userHesap, ...stats, requestId: req.id });

    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Failed to fetch order stats:', { userHesap, error: error.message, requestId: req.id });
    // SOAP fail olursa boş istatistik dönmeye devam
    res.json({
      success: true,
      data: { totalOrders: 0, totalAmount: 0, averageOrderValue: 0, recentOrdersCount: 0 },
    });
  }
}));

// ===============================
// GET /api/orders/:orderId
// ===============================
router.get('/:orderId', authenticateToken, catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const userHesap = req.user.hesap;

  if (!orderId) throw new AppError('Order ID is required', 400);

  logger.request(req, `Fetching order details: ${orderId}, user: ${userHesap}`);

  try {
    const all = await soapService.getOrders(userHesap);
    const order = (all || []).find(o => String(o.sipno) === String(orderId));
    if (!order) throw new AppError('Order not found', 404);

    res.json({ success: true, data: order });
  } catch (error) {
    logger.error('Failed to fetch order details:', { userHesap, orderId, error: error.message, requestId: req.id });
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to fetch order details', 500);
  }
}));

module.exports = router;
