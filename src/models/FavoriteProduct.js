const mongoose = require('mongoose');

const FavoriteProductSchema = new mongoose.Schema({
  user: {
    type: String,
    required: [true, 'User is required'],
    trim: true
  },
  
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
  
  // Favoriye eklendiğindeki TL fiyat (referans için)
  fiyat: {
    type: Number,
    min: 0,
    default: 0
  },
  
  // Kullanıcının hangi fiyat listesini kullandığı
  userPriceList: {
    type: Number,
    min: 1,
    max: 15,
    default: 1
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
  
  bakiye: {
    type: Number,
    default: 0
  },
  
  uruntipi: {
    type: String,
    default: ''
  },
  
  fgrp: {
    type: String,
    default: ''
  },
  
  fagrp: {
    type: String,
    default: ''
  },
  
  fatgrp: {
    type: String,
    default: ''
  },
  
  imageUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'favoriteProducts'
});

FavoriteProductSchema.index({ user: 1, stkno: 1 }, { unique: true });
FavoriteProductSchema.index({ user: 1, createdAt: -1 });

// NOTLAR:
// - Favorilerde sadece TL fiyatları saklanır (referans için)
// - Sepete eklenirken veya sipariş verilirken MongoDB'den güncel fiyatlar çekilir
// - Bu yaklaşım kur değişimlerinde otomatik güncelleme sağlar

FavoriteProductSchema.statics.getFavoritesByUser = function(userId) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();
};

FavoriteProductSchema.statics.addToFavorites = async function(userId, productData) {
  try {
    const favorite = new this({
      user: userId,
      ...productData
    });
    
    return await favorite.save();
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Product already in favorites');
    }
    throw error;
  }
};

FavoriteProductSchema.statics.removeFromFavorites = function(userId, stkno) {
  return this.findOneAndDelete({ user: userId, stkno });
};

module.exports = mongoose.model('FavoriteProduct', FavoriteProductSchema);