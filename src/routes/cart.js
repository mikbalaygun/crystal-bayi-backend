const express = require('express');
const router = express.Router();
const Cart = require('../models/Cart');
const { authenticateToken } = require('../middleware/auth');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ===============================
// GET /api/cart
// ===============================
router.get('/', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  
  logger.request(req, `Fetching cart for user: ${userHesap}`);
  
  const cart = await Cart.getCartByUser(userHesap);
  
  if (!cart) {
    return res.json({
      success: true,
      data: {
        items: [],
        lastSyncedAt: new Date()
      }
    });
  }
  
  res.json({
    success: true,
    data: {
      items: cart.items,
      lastSyncedAt: cart.lastSyncedAt
    }
  });
}));

// ===============================
// POST /api/cart/items
// ===============================
router.post('/items', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;
  const { stkno, stokadi, fiyat, cinsi, birim, grupadi, kdv, adet = 1, imageUrl } = req.body;
  
  if (!stkno || !stokadi || fiyat === undefined) {
    throw new AppError('Ürün bilgileri eksik', 400);
  }
  
  const itemData = {
    stkno,
    stokadi,
    fiyat: Number(fiyat),
    cinsi: cinsi || 'TRY',
    birim: birim || 'ADET',
    grupadi: grupadi || '',
    kdv: kdv || 18,
    adet: parseInt(adet),
    userPriceList,
    imageUrl: imageUrl || null
  };
  
  logger.request(req, `Adding item to cart: ${stkno}, user: ${userHesap}, priceList: ${userPriceList}`);
  
  const updatedCart = await Cart.addItemToCart(userHesap, itemData);
  
  logger.info('Item added to cart successfully', {
    userHesap,
    userPriceList,
    stkno,
    adet,
    requestId: req.id
  });
  
  res.json({
    success: true,
    data: {
      items: updatedCart.items,
      lastSyncedAt: updatedCart.lastSyncedAt
    },
    message: 'Ürün sepete eklendi'
  });
}));

// ===============================
// PUT /api/cart/items/:stkno
// ===============================
router.put('/items/:stkno', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const { stkno } = req.params;
  const { adet } = req.body;
  
  if (adet === undefined || adet < 0) {
    throw new AppError('Geçerli bir miktar giriniz', 400);
  }
  
  logger.request(req, `Updating item quantity: ${stkno}, adet: ${adet}, user: ${userHesap}`);
  
  const updatedCart = await Cart.updateItemQuantity(userHesap, stkno, parseInt(adet));
  
  if (!updatedCart) {
    throw new AppError('Ürün sepette bulunamadı', 404);
  }
  
  logger.info('Item quantity updated successfully', {
    userHesap,
    stkno,
    newAdet: adet,
    requestId: req.id
  });
  
  res.json({
    success: true,
    data: {
      items: updatedCart.items,
      lastSyncedAt: updatedCart.lastSyncedAt
    },
    message: 'Ürün miktarı güncellendi'
  });
}));

// ===============================
// DELETE /api/cart/items/:stkno
// ===============================
router.delete('/items/:stkno', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const { stkno } = req.params;
  
  logger.request(req, `Removing item from cart: ${stkno}, user: ${userHesap}`);
  
  const updatedCart = await Cart.removeItemFromCart(userHesap, stkno);
  
  if (!updatedCart) {
    throw new AppError('Ürün sepette bulunamadı', 404);
  }
  
  logger.info('Item removed from cart successfully', {
    userHesap,
    stkno,
    requestId: req.id
  });
  
  res.json({
    success: true,
    data: {
      items: updatedCart.items,
      lastSyncedAt: updatedCart.lastSyncedAt
    },
    message: 'Ürün sepetten çıkarıldı'
  });
}));

// ===============================
// DELETE /api/cart
// ===============================
router.delete('/', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  
  logger.request(req, `Clearing cart for user: ${userHesap}`);
  
  const updatedCart = await Cart.clearCart(userHesap);
  
  logger.info('Cart cleared successfully', {
    userHesap,
    requestId: req.id
  });
  
  res.json({
    success: true,
    data: {
      items: [],
      lastSyncedAt: updatedCart ? updatedCart.lastSyncedAt : new Date()
    },
    message: 'Sepet temizlendi'
  });
}));

// ===============================
// POST /api/cart/sync
// ===============================
router.post('/sync', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const userPriceList = req.user.list || 1;
  const { items = [] } = req.body;
  
  logger.request(req, `Syncing cart for user: ${userHesap}, items: ${items.length}`);
  
  // Local items validation
  const validItems = items.filter(item => 
    item.stkno && item.stokadi && typeof item.fiyat === 'number' && item.adet > 0
  ).map(item => ({
    ...item,
    userPriceList
  }));
  
  const syncedCart = await Cart.syncCart(userHesap, validItems);
  
  logger.info('Cart synced successfully', {
    userHesap,
    userPriceList,
    itemCount: syncedCart.items.length,
    requestId: req.id
  });
  
  res.json({
    success: true,
    data: {
      items: syncedCart.items,
      lastSyncedAt: syncedCart.lastSyncedAt
    },
    message: 'Sepet senkronize edildi'
  });
}));

// ===============================
// POST /api/cart/order
// ===============================
router.post('/order', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  
  logger.request(req, `Marking cart as ordered for user: ${userHesap}`);
  
  const orderedCart = await Cart.markAsOrdered(userHesap);
  
  if (!orderedCart) {
    throw new AppError('Aktif sepet bulunamadı', 404);
  }
  
  logger.info('Cart marked as ordered successfully', {
    userHesap,
    itemCount: orderedCart.items.length,
    requestId: req.id
  });
  
  res.json({
    success: true,
    message: 'Sepet sipariş olarak işaretlendi'
  });
}));

module.exports = router;