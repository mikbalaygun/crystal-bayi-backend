const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const FavoriteProduct = require('../models/FavoriteProduct');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Validation middleware for adding favorites
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
// Get user's favorite products
// ===============================
router.get('/', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  logger.request(req, `Fetching favorites for user: ${userHesap}`);

  try {
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

  } catch (error) {
    logger.error('Failed to fetch favorites:', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('Failed to fetch favorites', 500);
  }
}));

// ===============================
// POST /api/favorites
// Add product to favorites
// ===============================
router.post('/', authenticateToken, validateFavoriteProduct, catchAsync(async (req, res) => {
  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const userHesap = req.user.hesap;
  const productData = req.body;

  logger.request(req, `Adding product to favorites: ${productData.stkno}, user: ${userHesap}`);

  try {
    // Check if product is already in favorites
    const existingFavorite = await FavoriteProduct.findOne({
      userHesap,
      stkno: productData.stkno,
      isActive: true
    });

    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        message: 'Product is already in favorites',
        data: existingFavorite.toClientJSON()
      });
    }

    // Add to favorites
    const favorite = await FavoriteProduct.addToFavorites(userHesap, productData);

    logger.info('Product added to favorites successfully', {
      userHesap,
      stkno: productData.stkno,
      productName: productData.stokadi,
      requestId: req.id
    });

    res.status(201).json({
      success: true,
      message: 'Product added to favorites successfully',
      data: favorite.toClientJSON()
    });

  } catch (error) {
    logger.error('Failed to add product to favorites:', {
      userHesap,
      stkno: productData.stkno,
      error: error.message,
      requestId: req.id
    });

    if (error.message.includes('already in favorites')) {
      throw new AppError('Product is already in favorites', 409);
    }

    throw new AppError('Failed to add product to favorites', 500);
  }
}));

// ===============================
// DELETE /api/favorites/:stkno
// Remove product from favorites
// ===============================
router.delete('/:stkno', authenticateToken, catchAsync(async (req, res) => {
  const { stkno } = req.params;
  const userHesap = req.user.hesap;

  if (!stkno) {
    throw new AppError('Stock number is required', 400);
  }

  logger.request(req, `Removing product from favorites: ${stkno}, user: ${userHesap}`);

  try {
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

  } catch (error) {
    logger.error('Failed to remove product from favorites:', {
      userHesap,
      stkno,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('Failed to remove product from favorites', 500);
  }
}));

// ===============================
// POST /api/favorites/check
// Check if products are in favorites (bulk check)
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

  try {
    const favorites = await FavoriteProduct.find({
      userHesap,
      stkno: { $in: stknoList },
      isActive: true
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

  } catch (error) {
    logger.error('Failed to check favorites:', {
      userHesap,
      productCount: stknoList.length,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('Failed to check favorites', 500);
  }
}));

// ===============================
// GET /api/favorites/count
// Get favorite products count
// ===============================
router.get('/count', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;

  try {
    const count = await FavoriteProduct.countDocuments({
      userHesap,
      isActive: true
    });

    res.json({
      success: true,
      data: { count }
    });

  } catch (error) {
    logger.error('Failed to get favorites count:', {
      userHesap,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('Failed to get favorites count', 500);
  }
}));

module.exports = router;