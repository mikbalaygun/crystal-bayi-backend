const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
  // Ürün bilgileri - Product schema ile uyumlu
  stkno: {
    type: String,
    required: [true, 'Stock number is required'],
    trim: true
  },
  
  stokadi: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  
  fiyat: {
    type: Number,
    min: 0,
    required: [true, 'Price is required']
  },
  
  cinsi: {
    type: String,
    default: 'TRY' // Para birimi
  },
  
  birim: {
    type: String,
    default: 'ADET'
  },
  
  grupadi: {
    type: String,
    default: ''
  },
  
  kdv: {
    type: Number,
    min: 0,
    max: 100,
    default: 18
  },
  
  // Cart specific fields
  adet: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: 1,
    default: 1
  },
  
  // Sepete eklendiği anki fiyat (fiyat değişikliklerini takip için)
  addedPrice: {
    type: Number,
    required: true
  },
  
  // Sepete eklenme tarihi
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false }); // Sub-document olduğu için _id gereksiz

const CartSchema = new mongoose.Schema({
  // Kullanıcı bilgisi
  user: {
    type: String,
    required: [true, 'User is required'],
    trim: true
    // unique: true ve index: true kaldırıldı
  },
  
  // Sepet items
  items: [CartItemSchema],
  
  // Son güncelleme
  lastSyncedAt: {
    type: Date,
    default: Date.now
  },
  
  // Sepet durumu (aktif/pasif/sipariş verildi)
  status: {
    type: String,
    enum: ['active', 'ordered', 'abandoned'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'carts'
});

// Index'leri ayrı tanımla - duplicate index sorununu çözer
CartSchema.index({ user: 1 }, { unique: true }); // Unique constraint burada
CartSchema.index({ updatedAt: -1 });
CartSchema.index({ 'items.stkno': 1 });

// Static Methods
CartSchema.statics.getCartByUser = function(userId) {
  return this.findOne({ user: userId, status: 'active' }).lean();
};

CartSchema.statics.addItemToCart = async function(userId, itemData) {
  try {
    let cart = await this.findOne({ user: userId, status: 'active' });
    
    if (!cart) {
      // Yeni sepet oluştur
      cart = new this({
        user: userId,
        items: []
      });
    }
    
    // Aynı ürün var mı kontrol et
    const existingItemIndex = cart.items.findIndex(item => item.stkno === itemData.stkno);
    
    if (existingItemIndex > -1) {
      // Var olan ürünün miktarını artır
      cart.items[existingItemIndex].adet += itemData.adet || 1;
      cart.items[existingItemIndex].addedAt = new Date();
    } else {
      // Yeni ürün ekle
      cart.items.push({
        ...itemData,
        addedPrice: itemData.fiyat, // Ekleme anındaki fiyatı sakla
        addedAt: new Date()
      });
    }
    
    cart.lastSyncedAt = new Date();
    return await cart.save();
  } catch (error) {
    throw error;
  }
};

CartSchema.statics.updateItemQuantity = async function(userId, stkno, newQuantity) {
  if (newQuantity <= 0) {
    return this.removeItemFromCart(userId, stkno);
  }
  
  return this.findOneAndUpdate(
    { user: userId, status: 'active', 'items.stkno': stkno },
    { 
      $set: { 
        'items.$.adet': newQuantity,
        'items.$.addedAt': new Date(),
        lastSyncedAt: new Date()
      }
    },
    { new: true }
  );
};

CartSchema.statics.removeItemFromCart = function(userId, stkno) {
  return this.findOneAndUpdate(
    { user: userId, status: 'active' },
    { 
      $pull: { items: { stkno: stkno } },
      $set: { lastSyncedAt: new Date() }
    },
    { new: true }
  );
};

CartSchema.statics.clearCart = function(userId) {
  return this.findOneAndUpdate(
    { user: userId, status: 'active' },
    { 
      $set: { 
        items: [], 
        lastSyncedAt: new Date() 
      }
    },
    { new: true }
  );
};

CartSchema.statics.syncCart = async function(userId, localItems) {
  try {
    let cart = await this.findOne({ user: userId, status: 'active' });
    
    if (!cart) {
      // Yeni sepet oluştur
      cart = new this({
        user: userId,
        items: localItems.map(item => ({
          ...item,
          addedPrice: item.fiyat,
          addedAt: new Date()
        }))
      });
    } else {
      // Mevcut sepet ile local sepeti merge et
      const mergedItems = this.mergeCartItems(cart.items, localItems);
      cart.items = mergedItems;
    }
    
    cart.lastSyncedAt = new Date();
    return await cart.save();
  } catch (error) {
    throw error;
  }
};

// Helper method for merging cart items
CartSchema.statics.mergeCartItems = function(serverItems, localItems) {
  const merged = [...serverItems];
  
  localItems.forEach(localItem => {
    const existingIndex = merged.findIndex(item => item.stkno === localItem.stkno);
    
    if (existingIndex > -1) {
      // Hangi miktar daha büyükse onu al (kullanıcı dostu)
      if (localItem.adet > merged[existingIndex].adet) {
        merged[existingIndex].adet = localItem.adet;
        merged[existingIndex].addedAt = new Date();
      }
    } else {
      // Yeni item ekle
      merged.push({
        ...localItem,
        addedPrice: localItem.fiyat,
        addedAt: new Date()
      });
    }
  });
  
  return merged;
};

// Sepeti sipariş durumuna çevir
CartSchema.statics.markAsOrdered = function(userId) {
  return this.findOneAndUpdate(
    { user: userId, status: 'active' },
    { 
      status: 'ordered',
      lastSyncedAt: new Date()
    },
    { new: true }
  );
};

module.exports = mongoose.model('Cart', CartSchema);