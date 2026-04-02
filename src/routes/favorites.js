const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const FavoriteProduct = require('../models/FavoriteProduct');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const validateFavoriteProduct = [
  body('stkno')
    .trim()
    .notEmpty()
    .withMessage('Stock number is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Stock number must be between 1-50 characters'),
    
  body('stokadi')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Product name must be between 1-200 characters'),
    
  body('fiyat')
    .optional()
    .isNumeric()
    .withMessage('Price must be a number')
    .custom(value => {
      if (value < 0) {
        throw new Error('Price cannot be negative');
      }
      return true;
    }),
    
  body('birim').optional().isString().trim(),
  body('grupadi').optional().isString().trim(),
  body('kdv').optional().isNumeric().custom(value => {
    if (value < 0 || value > 100) {
      throw new Error('KDV must be between 0-100');
    }
    return true;
  }),
  body('bakiye').optional().isNumeric(),
  body('uruntipi').optional().isString().trim()
];

// ===============================
// GET /api/favorites
// ===============================
router.get('/', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  logger.request(req, `Fetching favorites for user: ${userHesap}`);

  const favorites = await FavoriteProduct.getFavoritesByUser(userHesap);

  logger.info('Favorites fetched successfully', {
    userHesap,
    favoriteCount: favorites.length,
    requestId: req.id
  });

  res.json({
    success: true,
    data: favorites
  });
}));

// ===============================
// POST /api/favorites
// ===============================
router.post('/', authenticateToken, validateFavoriteProduct, catchAsync(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;
  const productData = req.body;

  logger.request(req, `Adding product to favorites: ${productData.stkno}, user: ${userHesap}, priceList: ${userPriceList}`);

  const existingFavorite = await FavoriteProduct.findOne({
    user: userHesap,
    stkno: productData.stkno
  });

  if (existingFavorite) {
    return res.status(409).json({
      success: false,
      message: 'Product is already in favorites',
      data: existingFavorite
    });
  }

  // Kullanıcının fiyat listesi bilgisini ekle
  const favoriteData = {
    ...productData,
    userPriceList
  };

  const favorite = await FavoriteProduct.addToFavorites(userHesap, favoriteData);

  logger.info('Product added to favorites successfully', {
    userHesap,
    userPriceList,
    stkno: productData.stkno,
    productName: productData.stokadi,
    requestId: req.id
  });

  res.status(201).json({
    success: true,
    message: 'Product added to favorites successfully',
    data: favorite
  });
}));

// ===============================
// DELETE /api/favorites/:stkno
// ===============================
router.delete('/:stkno', authenticateToken, catchAsync(async (req, res) => {
  const { stkno } = req.params;
  const userHesap = req.user.hesap;

  if (!stkno) {
    throw new AppError('Stock number is required', 400);
  }

  logger.request(req, `Removing product from favorites: ${stkno}, user: ${userHesap}`);

  const removedFavorite = await FavoriteProduct.removeFromFavorites(userHesap, stkno);

  if (!removedFavorite) {
    return res.status(404).json({
      success: false,
      message: 'Product not found in favorites'
    });
  }

  logger.info('Product removed from favorites successfully', {
    userHesap,
    stkno,
    productName: removedFavorite.stokadi,
    requestId: req.id
  });

  res.json({
    success: true,
    message: 'Product removed from favorites successfully'
  });
}));

// ===============================
// POST /api/favorites/check
// ===============================
router.post('/check', authenticateToken, catchAsync(async (req, res) => {
  const { stknoList } = req.body;
  const userHesap = req.user.hesap;

  if (!Array.isArray(stknoList) || stknoList.length === 0) {
    throw new AppError('Stock number list is required', 400);
  }

  if (stknoList.length > 100) {
    throw new AppError('Maximum 100 products can be checked at once', 400);
  }

  logger.request(req, `Checking favorites for ${stknoList.length} products, user: ${userHesap}`);

  const favorites = await FavoriteProduct.find({
    user: userHesap,
    stkno: { $in: stknoList }
  }, 'stkno').lean();

  const favoriteStockNumbers = favorites.map(f => f.stkno);
  
  const result = stknoList.map(stkno => ({
    stkno,
    isFavorite: favoriteStockNumbers.includes(stkno)
  }));

  logger.info('Favorite check completed', {
    userHesap,
    checkedProducts: stknoList.length,
    foundFavorites: favoriteStockNumbers.length,
    requestId: req.id
  });

  res.json({
    success: true,
    data: result
  });
}));

// ===============================
// GET /api/favorites/count
// ===============================
router.get('/count', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  const count = await FavoriteProduct.countDocuments({
    user: userHesap
  });

  res.json({
    success: true,
    data: { count }
  });
}));

module.exports = router;