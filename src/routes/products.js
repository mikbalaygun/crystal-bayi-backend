const express = require('express');
const { query, validationResult } = require('express-validator');
const router = express.Router();

const Product = require('../models/Product');
const Category = require('../models/Category');
const { fullSync, deltaSync, syncCategories } = require('../services/productSyncService');
const soapService = require('../services/soapService');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const { syncProductImages } = require('../services/imageSyncService');
const currencyService = require('../services/currencyService');

const validateProductFilters = [
  query('fgrp').optional().isString().trim(),
  query('fagrp').optional().isString().trim(),
  query('fatgrp').optional().isString().trim(),
  query('search').optional().isString().trim().isLength({ min: 2, max: 100 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
];

async function buildCategoryFilters({ fgrp, fagrp, fatgrp }) {
  const andFilters = [];

  if (fgrp) {
    const cat = await Category.findOne({ grpkod: fgrp }).lean();
    andFilters.push({
      $or: [
        { fgrp },
        ...(cat?.grpadi ? [{ grupadi: cat.grpadi }] : [])
      ]
    });
  }

  if (fagrp) {
    const cat = await Category.findOne({ grpkod: fagrp }).lean();
    andFilters.push({
      $or: [
        { fagrp },
        ...(cat?.grpadi ? [{ altgrupadi: cat.grpadi }, { grupadi2: cat.grpadi }] : [])
      ]
    });
  }

  if (fatgrp) {
    const cat = await Category.findOne({ grpkod: fatgrp }).lean();
    andFilters.push({
      $or: [
        { fatgrp },
        ...(cat?.grpadi ? [{ altgrupadi2: cat.grpadi }, { grupadi3: cat.grpadi }] : [])
      ]
    });
  }

  return andFilters.length ? { $and: andFilters } : {};
}

// ===============================
// GET /api/products (MONGODB)
// ===============================
router.get('/', authenticateToken, validateProductFilters, catchAsync(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid filter parameters',
      errors: errors.array()
    });
  }

  const { fgrp, fagrp, fatgrp, search, page = 1, limit = 50 } = req.query;
  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;

  logger.request(req, `MongoDB products list for user: ${userHesap}, priceList: ${userPriceList}`);

  const query = { isActive: { $ne: false } };
  const catFilter = await buildCategoryFilters({ fgrp, fagrp, fatgrp });
  Object.assign(query, catFilter);

  if (search && search.length >= 2) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    query.$or = [
      { $text: { $search: search } },
      { stokadi: regex },
      { stkno: regex },
      { grupadi: regex }
    ];
  }

  const skip = (page - 1) * limit;

  const [products, totalCount] = await Promise.all([
    Product.find(query)
      .select('stkno stokadi grupadi priceList cinsi bakiye birim kdv uruntipi fgrp fagrp fatgrp imageUrl')
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query)
  ]);

  // Kullanıcının fiyat listesine göre fiyatı ekle
  const productsWithPrice = products.map(p => ({
    stkno: p.stkno,
    stokadi: p.stokadi,
    grupadi: p.grupadi,
    fiyat: p.priceList?.[`fiyat${userPriceList}`] || 0,
    cinsi: 'TRY',
    bakiye: p.bakiye,
    birim: p.birim,
    kdv: p.kdv,
    uruntipi: p.uruntipi,
    fgrp: p.fgrp,
    fagrp: p.fagrp,
    fatgrp: p.fatgrp,
    imageUrl: p.imageUrl
  }));

  logger.info('MongoDB products fetched', {
    userHesap,
    userPriceList,
    totalProducts: totalCount,
    returnedProducts: productsWithPrice.length,
    page,
    limit,
    requestId: req.id
  });

  return res.json({
    success: true,
    data: {
      products: productsWithPrice,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(totalCount / limit),
        totalProducts: totalCount,
        hasNextPage: skip + limit < totalCount,
        hasPrevPage: page > 1
      },
      filters: { fgrp: fgrp || null, fagrp: fagrp || null, fatgrp: fatgrp || null, search: search || null }
    }
  });
}));

// ===============================
// GET /api/products/groups (MONGODB)
// ===============================
router.get('/groups', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  logger.request(req, `Fetching product groups from MongoDB for user: ${userHesap}`);

  const groups = await Category.find({ level: 1, isActive: true })
    .select('grpkod grpadi level')
    .sort({ grpadi: 1 })
    .lean();

  logger.info('Product groups fetched from MongoDB', {
    userHesap,
    groupCount: groups.length,
    requestId: req.id
  });

  return res.json({ success: true, data: groups });
}));

// ===============================
// GET /api/products/groups/:groupId/subgroups (MONGODB)
// ===============================
router.get('/groups/:groupId/subgroups', authenticateToken, catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userHesap = req.user.hesap;
  if (!groupId) throw new AppError('Group ID is required', 400);

  logger.request(req, `Fetching sub groups from MongoDB for group: ${groupId}, user: ${userHesap}`);

  const subGroups = await Category.find({
    level: 2,
    parentId: groupId,
    isActive: true
  })
    .select('grpkod grpadi level parentId')
    .sort({ grpadi: 1 })
    .lean();

  logger.info('Sub groups fetched from MongoDB', {
    userHesap,
    groupId,
    subGroupCount: subGroups.length,
    requestId: req.id
  });

  return res.json({ success: true, data: subGroups });
}));

// ===============================
// GET /api/products/groups/:groupId/subgroups2 (MONGODB)
// ===============================
router.get('/groups/:groupId/subgroups2', authenticateToken, catchAsync(async (req, res) => {
  const { groupId } = req.params;
  const userHesap = req.user.hesap;
  if (!groupId) throw new AppError('Group ID is required', 400);

  logger.request(req, `Fetching sub groups2 from MongoDB for group: ${groupId}, user: ${userHesap}`);

  const subGroups2 = await Category.find({
    level: 3,
    parentId: groupId,
    isActive: true
  })
    .select('grpkod grpadi level parentId')
    .sort({ grpadi: 1 })
    .lean();

  logger.info('Sub groups2 fetched from MongoDB', {
    userHesap,
    groupId,
    subGroup2Count: subGroups2.length,
    requestId: req.id
  });

  return res.json({ success: true, data: subGroups2 });
}));

// ===============================
// GET /api/products/search (MONGO ARAMA + KATEGORİ FİLTRELERİ)
// ===============================
router.get('/search', authenticateToken, catchAsync(async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;
  const userPriceList = req.user.list || 1;

  if (q.length < 2) {
    throw new AppError('Search term must be at least 2 characters', 400);
  }

  const { fgrp, fagrp, fatgrp } = req.query;
  const catFilter = await buildCategoryFilters({ fgrp, fagrp, fatgrp });

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const query = {
    isActive: { $ne: false },
    ...catFilter,
    $or: [
      { $text: { $search: q } },
      { stokadi: regex },
      { stkno: regex },
      { grupadi: regex }
    ]
  };

  const projection = {
    score: { $meta: 'textScore' },
    stkno: 1, stokadi: 1, grupadi: 1, priceList: 1, cinsi: 1, bakiye: 1, birim: 1, kdv: 1, uruntipi: 1, imageUrl: 1
  };

  const [items, total] = await Promise.all([
    Product.find(query, projection).sort({ score: { $meta: 'textScore' } }).skip(skip).limit(limit).lean(),
    Product.countDocuments(query)
  ]);

  // Kullanıcının fiyat listesine göre fiyatı ekle
  const productsWithPrice = items.map(p => ({
    stkno: p.stkno,
    stokadi: p.stokadi,
    grupadi: p.grupadi,
    fiyat: p.priceList?.[`fiyat${userPriceList}`] || 0,
    cinsi: 'TRY',
    bakiye: p.bakiye,
    birim: p.birim,
    kdv: p.kdv,
    uruntipi: p.uruntipi,
    imageUrl: p.imageUrl
  }));

  logger.info('Mongo search completed', {
    q, userPriceList, totalMatched: total, returned: productsWithPrice.length, page, limit, requestId: req.id
  });

  return res.json({
    success: true,
    data: {
      products: productsWithPrice,
      totalMatched: total,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        limit
      },
      q
    }
  });
}));

// ===============================
// GET /api/products/:stockNo (MONGO)
// ===============================
router.get('/:stockNo', authenticateToken, catchAsync(async (req, res) => {
  const { stockNo } = req.params;
  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;
  
  if (!stockNo) throw new AppError('Stock number is required', 400);

  logger.request(req, `Fetching single product: ${stockNo}, user: ${userHesap}, priceList: ${userPriceList}`);

  const fromDb = await Product.findOne({ stkno: stockNo, isActive: { $ne: false } })
    .select('stkno stokadi grupadi priceList cinsi bakiye birim kdv uruntipi imageUrl')
    .lean();

  if (!fromDb) {
    throw new AppError('Product not found', 404);
  }

  const productWithPrice = {
    stkno: fromDb.stkno,
    stokadi: fromDb.stokadi,
    grupadi: fromDb.grupadi,
    fiyat: fromDb.priceList?.[`fiyat${userPriceList}`] || 0,
    cinsi: 'TRY',
    bakiye: fromDb.bakiye,
    birim: fromDb.birim,
    kdv: fromDb.kdv,
    uruntipi: fromDb.uruntipi,
    imageUrl: fromDb.imageUrl
  };
  
  return res.json({ success: true, data: productWithPrice, source: 'mongo' });
}));

// ===============================
// POST /api/products/sync
// ===============================
router.post('/sync', authenticateToken, catchAsync(async (req, res) => {
  if (process.env.ALLOW_PRODUCT_SYNC !== 'true') {
    throw new AppError('Sync is disabled', 403);
  }

  const mode = (req.query.mode || 'delta').toLowerCase();
  logger.request(req, `Manual product sync triggered: mode=${mode}, by=${req.user.hesap}`);

  const result = mode === 'full' ? await fullSync() : await deltaSync();
  return res.json({ success: true, mode, ...result });
}));

// ===============================
// POST /api/products/sync-categories
// ===============================
router.post('/sync-categories', authenticateToken, catchAsync(async (req, res) => {
  if (process.env.ALLOW_PRODUCT_SYNC !== 'true') {
    throw new AppError('Sync is disabled', 403);
  }

  logger.request(req, `Manual category sync triggered by: ${req.user.hesap}`);

  const result = await syncCategories();
  return res.json({ success: true, categories: result });
}));

// ===============================
// POST /api/products/sync-images
// ===============================
router.post('/sync-images', authenticateToken, catchAsync(async (req, res) => {
  if (process.env.ALLOW_PRODUCT_SYNC !== 'true') {
    throw new AppError('Image sync is disabled', 403);
  }

  logger.request(req, `Manual image sync triggered by: ${req.user.hesap}`);

  const result = await syncProductImages();
  return res.json({ success: true, ...result });
}));

// ===============================
// GET /api/products/debug/price-lists
// ===============================
router.get('/debug/price-lists', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;
  
  logger.request(req, `Debug: Analyzing price lists for user: ${userHesap}, list: ${userPriceList}`);

  try {
    // MongoDB'den örnek ürünler
    const sampleProducts = await Product.find({ isActive: { $ne: false } })
      .select('stkno stokadi grupadi priceList cinsi')
      .limit(10)
      .lean();

    // Kullanıcının fiyat listesine göre dönüştür
    const productsWithUserPrice = sampleProducts.map(p => ({
      stkno: p.stkno,
      stokadi: p.stokadi,
      grupadi: p.grupadi,
      userPrice: p.priceList?.[`fiyat${userPriceList}`] || 0,
      allPrices: p.priceList,
      cinsi: p.cinsi
    }));

    return res.json({
      success: true,
      data: {
        userPriceList,
        sampleProducts: productsWithUserPrice,
        totalProducts: await Product.countDocuments({ isActive: { $ne: false } })
      }
    });

  } catch (error) {
    logger.error('Price lists debug error', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to analyze price lists',
      error: error.message
    });
  }
}));

// TEST: priceList kontrolü
router.get('/test-pricelist/:stkno', authenticateToken, catchAsync(async (req, res) => {
  const { stkno } = req.params;
  
  const product = await Product.findOne({ stkno }).lean();
  
  if (!product) {
    return res.json({ success: false, message: 'Product not found' });
  }
  
  return res.json({
    success: true,
    data: {
      stkno: product.stkno,
      stokadi: product.stokadi,
      priceList: product.priceList,
      rawData: product._raw
    }
  });
}));

// Kur bilgilerini göster
router.get('/currency-rates', authenticateToken, catchAsync(async (req, res) => {
  const rates = await currencyService.getAllRates();
  
  res.json({
    success: true,
    rates
  });
}));

// GEÇICI: MongoDB temizleme endpoint'i (sadece test için)
router.delete('/cleanup-all', authenticateToken, catchAsync(async (req, res) => {
  // Sadece admin kullanıcılar çalıştırabilir
  if (req.user.type !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  logger.warn('Cleaning up all products from database', {
    user: req.user.hesap,
    requestId: req.id
  });

  const result = await Product.deleteMany({});

  logger.info('Products cleaned up', {
    deletedCount: result.deletedCount,
    user: req.user.hesap,
    requestId: req.id
  });

  res.json({
    success: true,
    message: 'All products deleted',
    deletedCount: result.deletedCount
  });
}));

// products.js route'una ekleyin
router.delete('/cleanup-cart-favorites', authenticateToken, catchAsync(async (req, res) => {
  if (req.user.type !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  const Cart = require('../models/Cart');
  const FavoriteProduct = require('../models/FavoriteProduct');

  const cartResult = await Cart.deleteMany({});
  const favResult = await FavoriteProduct.deleteMany({});

  logger.warn('Cart and favorites cleaned up', {
    cartsDeleted: cartResult.deletedCount,
    favoritesDeleted: favResult.deletedCount,
    user: req.user.hesap
  });

  res.json({
    success: true,
    cartsDeleted: cartResult.deletedCount,
    favoritesDeleted: favResult.deletedCount
  });
}));

module.exports = router;