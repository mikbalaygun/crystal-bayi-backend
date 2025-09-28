const express = require('express');
const router = express.Router();
const Cart = require('../models/Cart'); // Cart model'inizi import edin
const { authenticateToken } = require('../middleware/auth'); // Auth middleware

// GET /api/cart - Kullanıcının sepetini getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    const cart = await Cart.getCartByUser(req.user.username);
    
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
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({
      success: false,
      error: 'Sepet yüklenirken hata oluştu'
    });
  }
});

// POST /api/cart/items - Sepete ürün ekle
router.post('/items', authenticateToken, async (req, res) => {
  try {
    const { stkno, stokadi, fiyat, cinsi, birim, grupadi, kdv, adet = 1 } = req.body;
    
    // Validation
    if (!stkno || !stokadi || !fiyat) {
      return res.status(400).json({
        success: false,
        error: 'Ürün bilgileri eksik'
      });
    }
    
    const itemData = {
      stkno,
      stokadi,
      fiyat,
      cinsi: cinsi || 'TRY',
      birim: birim || 'ADET',
      grupadi: grupadi || '',
      kdv: kdv || 18,
      adet: parseInt(adet)
    };
    
    const updatedCart = await Cart.addItemToCart(req.user.username, itemData);
    
    res.json({
      success: true,
      data: {
        items: updatedCart.items,
        lastSyncedAt: updatedCart.lastSyncedAt
      },
      message: 'Ürün sepete eklendi'
    });
  } catch (error) {
    console.error('Error adding item to cart:', error);
    res.status(500).json({
      success: false,
      error: 'Ürün sepete eklenirken hata oluştu'
    });
  }
});

// PUT /api/cart/items/:stkno - Ürün miktarını güncelle
router.put('/items/:stkno', authenticateToken, async (req, res) => {
  try {
    const { stkno } = req.params;
    const { adet } = req.body;
    
    if (!adet || adet < 0) {
      return res.status(400).json({
        success: false,
        error: 'Geçerli bir miktar giriniz'
      });
    }
    
    const updatedCart = await Cart.updateItemQuantity(req.user.username, stkno, parseInt(adet));
    
    if (!updatedCart) {
      return res.status(404).json({
        success: false,
        error: 'Ürün sepette bulunamadı'
      });
    }
    
    res.json({
      success: true,
      data: {
        items: updatedCart.items,
        lastSyncedAt: updatedCart.lastSyncedAt
      },
      message: 'Ürün miktarı güncellendi'
    });
  } catch (error) {
    console.error('Error updating item quantity:', error);
    res.status(500).json({
      success: false,
      error: 'Ürün miktarı güncellenirken hata oluştu'
    });
  }
});

// DELETE /api/cart/items/:stkno - Ürünü sepetten çıkar
router.delete('/items/:stkno', authenticateToken, async (req, res) => {
  try {
    const { stkno } = req.params;
    
    const updatedCart = await Cart.removeItemFromCart(req.user.username, stkno);
    
    if (!updatedCart) {
      return res.status(404).json({
        success: false,
        error: 'Ürün sepette bulunamadı'
      });
    }
    
    res.json({
      success: true,
      data: {
        items: updatedCart.items,
        lastSyncedAt: updatedCart.lastSyncedAt
      },
      message: 'Ürün sepetten çıkarıldı'
    });
  } catch (error) {
    console.error('Error removing item from cart:', error);
    res.status(500).json({
      success: false,
      error: 'Ürün sepetten çıkarılırken hata oluştu'
    });
  }
});

// DELETE /api/cart - Sepeti temizle
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const updatedCart = await Cart.clearCart(req.user.username);
    
    res.json({
      success: true,
      data: {
        items: [],
        lastSyncedAt: updatedCart ? updatedCart.lastSyncedAt : new Date()
      },
      message: 'Sepet temizlendi'
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({
      success: false,
      error: 'Sepet temizlenirken hata oluştu'
    });
  }
});

// POST /api/cart/sync - Local cart ile server cart'ı senkronize et
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const { items = [] } = req.body;
    
    // Local items validation
    const validItems = items.filter(item => 
      item.stkno && item.stokadi && typeof item.fiyat === 'number' && item.adet > 0
    );
    
    const syncedCart = await Cart.syncCart(req.user.username, validItems);
    
    res.json({
      success: true,
      data: {
        items: syncedCart.items,
        lastSyncedAt: syncedCart.lastSyncedAt
      },
      message: 'Sepet senkronize edildi'
    });
  } catch (error) {
    console.error('Error syncing cart:', error);
    res.status(500).json({
      success: false,
      error: 'Sepet senkronize edilirken hata oluştu'
    });
  }
});

// POST /api/cart/order - Sepeti sipariş olarak işaretle (sipariş verildikten sonra)
router.post('/order', authenticateToken, async (req, res) => {
  try {
    const orderedCart = await Cart.markAsOrdered(req.user.username);
    
    if (!orderedCart) {
      return res.status(404).json({
        success: false,
        error: 'Aktif sepet bulunamadı'
      });
    }
    
    res.json({
      success: true,
      message: 'Sepet sipariş olarak işaretlendi'
    });
  } catch (error) {
    console.error('Error marking cart as ordered:', error);
    res.status(500).json({
      success: false,
      error: 'Sepet güncellenirken hata oluştu'
    });
  }
});

module.exports = router;