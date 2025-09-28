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
        { fgrp },                                   // kod
        ...(cat?.grpadi ? [{ grupadi: cat.grpadi }] : []) // ad
      ]
    });
  }

  if (fagrp) {
    const cat = await Category.findOne({ grpkod: fagrp }).lean();
    // Üründe alt grup adını hangi alan(lar)da saklıyorsan onları ekle
    andFilters.push({
      $or: [
        { fagrp },                                                // kod
        ...(cat?.grpadi ? [{ altgrupadi: cat.grpadi }, { grupadi2: cat.grpadi }] : []) // ad olası alanlar
      ]
    });
  }

  if (fatgrp) {
    const cat = await Category.findOne({ grpkod: fatgrp }).lean();
    andFilters.push({
      $or: [
        { fatgrp },                                                 // kod
        ...(cat?.grpadi ? [{ altgrupadi2: cat.grpadi }, { grupadi3: cat.grpadi }] : []) // ad olası alanlar
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

  logger.request(req, `MongoDB products list for user: ${userHesap}`);

  // Temel query
  const query = { isActive: { $ne: false } };

  // Kategori filtreleri (kod veya ada göre)
  const catFilter = await buildCategoryFilters({ fgrp, fagrp, fatgrp });
  Object.assign(query, catFilter);

  // Arama filtresi
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
      .select('stkno stokadi grupadi fiyat cinsi bakiye birim kdv uruntipi fgrp fagrp fatgrp') // ← cinsi eklendi
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query)
  ]);

  logger.info('MongoDB products fetched', {
    userHesap,
    totalProducts: totalCount,
    returnedProducts: products.length,
    page,
    limit,
    requestId: req.id
  });

  return res.json({
    success: true,
    data: {
      products,
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
    stkno: 1, stokadi: 1, grupadi: 1, fiyat: 1, cinsi: 1, bakiye: 1, birim: 1, kdv: 1, uruntipi: 1 // ← cinsi eklendi
  };

  const [items, total] = await Promise.all([
    Product.find(query, projection).sort({ score: { $meta: 'textScore' } }).skip(skip).limit(limit).lean(),
    Product.countDocuments(query)
  ]);

  logger.info('Mongo search completed', {
    q, totalMatched: total, returned: items.length, page, limit, requestId: req.id
  });

  return res.json({
    success: true,
    data: {
      products: items,
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
// GET /api/products/:stockNo (MONGO + ERP FALLBACK)
// ===============================
router.get('/:stockNo', authenticateToken, catchAsync(async (req, res) => {
  const { stockNo } = req.params;
  const userHesap = req.user.hesap;
  if (!stockNo) throw new AppError('Stock number is required', 400);

  logger.request(req, `Fetching single product: ${stockNo}, user: ${userHesap}`);

  // 1) MongoDB
  const fromDb = await Product.findOne({ stkno: stockNo, isActive: { $ne: false } })
    .select({ stkno: 1, stokadi: 1, grupadi: 1, fiyat: 1, cinsi: 1, bakiye: 1, birim: 1, kdv: 1, uruntipi: 1, _id: 0 }) // ← cinsi eklendi
    .lean();

  if (fromDb) {
    return res.json({ success: true, data: fromDb, source: 'mongo' });
  }

  // 2) ERP fallback
  const all = await soapService.getProducts(userHesap, {}) || [];
  const found = all.find(p => p.stkno === stockNo);
  if (!found) throw new AppError('Product not found', 404);

  return res.json({ success: true, data: found, source: 'erp' });
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
// GET /api/products/debug/currency-values (CİNSİ FIELD'INDAKI DEĞERLER)
// ===============================
router.get('/debug/currency-values', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  
  logger.request(req, `Debug: Analyzing currency values for user: ${userHesap}`);

  try {
    // MongoDB'den cinsi değerlerini analiz et
    const currencyAnalysis = await Product.aggregate([
      { $match: { isActive: { $ne: false } } },
      { 
        $group: { 
          _id: "$cinsi", 
          count: { $sum: 1 },
          sampleProducts: { $push: { stkno: "$stkno", stokadi: "$stokadi", grupadi: "$grupadi", fiyat: "$fiyat" } }
        } 
      },
      { $sort: { count: -1 } },
      {
        $project: {
          cinsi: "$_id",
          count: 1,
          sampleProducts: { $slice: ["$sampleProducts", 5] }, // Her gruptan 5 örnek
          _id: 0
        }
      }
    ]);

    // SOAP'tan da cinsi değerlerini kontrol et
    const soapProducts = await soapService.getProducts(userHesap, {});
    const soapCurrencyValues = {};
    
    soapProducts.forEach(product => {
      const cinsi = product.cinsi || 'empty';
      if (!soapCurrencyValues[cinsi]) {
        soapCurrencyValues[cinsi] = {
          count: 0,
          samples: []
        };
      }
      soapCurrencyValues[cinsi].count++;
      if (soapCurrencyValues[cinsi].samples.length < 5) {
        soapCurrencyValues[cinsi].samples.push({
          stkno: product.stkno,
          stokadi: product.stokadi,
          grupadi: product.grupadi,
          fiyat: product.fiyat
        });
      }
    });

    // Profil grubundaki ürünleri özel analiz
    const profilProducts = await Product.find({ 
      grupadi: /PROFIL/i,
      isActive: { $ne: false }
    })
    .select('stkno stokadi grupadi fiyat cinsi')
    .limit(10)
    .lean();

    const profilSoapProducts = soapProducts.filter(p => 
      p.grupadi && p.grupadi.toUpperCase().includes('PROFIL')
    ).slice(0, 10);

    return res.json({
      success: true,
      data: {
        mongoDbCurrencyAnalysis: currencyAnalysis,
        soapCurrencyAnalysis: Object.entries(soapCurrencyValues).map(([cinsi, data]) => ({
          cinsi: cinsi === 'empty' ? '(empty)' : cinsi,
          count: data.count,
          samples: data.samples
        })),
        profilProductsInMongoDB: profilProducts,
        profilProductsInSOAP: profilSoapProducts,
        summary: {
          totalMongoProducts: await Product.countDocuments({ isActive: { $ne: false } }),
          totalSoapProducts: soapProducts.length,
          profilCountMongo: profilProducts.length,
          profilCountSoap: profilSoapProducts.length
        }
      }
    });

  } catch (error) {
    logger.error('Currency values debug error', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to analyze currency values',
      error: error.message
    });
  }
}));

module.exports = router;