const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
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
  
  // Frontend için TL fiyat
  fiyat: {
    type: Number,
    min: 0,
    required: [true, 'Price is required']
  },
  
  // Frontend için para birimi (her zaman TRY)
  cinsi: {
    type: String,
    default: 'TRY'
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
  
  adet: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: 1,
    default: 1
  },
  
  // Kullanıcının fiyat listesi
  userPriceList: {
    type: Number,
    min: 1,
    max: 15,
    default: 1
  },
  
  // Sepete eklendiğindeki TL fiyat (referans için)
  addedPrice: {
    type: Number,
    required: true
  },
  
  addedAt: {
    type: Date,
    default: Date.now
  },
  
  imageUrl: {
    type: String,
    default: null
  }
}, { _id: false });

const CartSchema = new mongoose.Schema({
  user: {
    type: String,
    required: [true, 'User is required'],
    trim: true
  },
  
  items: [CartItemSchema],
  
  lastSyncedAt: {
    type: Date,
    default: Date.now
  },
  
  status: {
    type: String,
    enum: ['active', 'ordered', 'abandoned'],
    default: 'active'
  }
}, {
  timestamps: true,
  collection: 'carts'
});

CartSchema.index({ user: 1 }, { unique: true });
CartSchema.index({ updatedAt: -1 });
CartSchema.index({ 'items.stkno': 1 });

// NOTLAR:
// - Sepette sadece TL fiyatları saklanır (UI için)
// - Sipariş esnasında MongoDB'den güncel orijinal fiyatlar çekilir
// - Bu yaklaşım kur değişimlerinde otomatik güncelleme sağlar

CartSchema.statics.getCartByUser = function(userId) {
  return this.findOne({ user: userId, status: 'active' }).lean();
};

CartSchema.statics.addItemToCart = async function(userId, itemData) {
  try {
    let cart = await this.findOne({ user: userId, status: 'active' });
    
    if (!cart) {
      cart = new this({
        user: userId,
        items: []
      });
    }
    
    const existingItemIndex = cart.items.findIndex(item => item.stkno === itemData.stkno);
    
    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].adet += itemData.adet || 1;
      cart.items[existingItemIndex].addedAt = new Date();
      cart.items[existingItemIndex].fiyat = itemData.fiyat; // Güncel fiyatı güncelle
      cart.items[existingItemIndex].addedPrice = itemData.fiyat;
    } else {
      cart.items.push({
        ...itemData,
        addedPrice: itemData.fiyat,
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
      cart = new this({
        user: userId,
        items: localItems.map(item => ({
          ...item,
          addedPrice: item.fiyat,
          addedAt: new Date()
        }))
      });
    } else {
      const mergedItems = this.mergeCartItems(cart.items, localItems);
      cart.items = mergedItems;
    }
    
    cart.lastSyncedAt = new Date();
    return await cart.save();
  } catch (error) {
    throw error;
  }
};

CartSchema.statics.mergeCartItems = function(serverItems, localItems) {
  const merged = [...serverItems];
  
  localItems.forEach(localItem => {
    const existingIndex = merged.findIndex(item => item.stkno === localItem.stkno);
    
    if (existingIndex > -1) {
      if (localItem.adet > merged[existingIndex].adet) {
        merged[existingIndex].adet = localItem.adet;
        merged[existingIndex].addedAt = new Date();
        merged[existingIndex].fiyat = localItem.fiyat; // Güncel fiyat
        merged[existingIndex].addedPrice = localItem.fiyat;
      }
    } else {
      merged.push({
        ...localItem,
        addedPrice: localItem.fiyat,
        addedAt: new Date()
      });
    }
  });
  
  return merged;
};

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