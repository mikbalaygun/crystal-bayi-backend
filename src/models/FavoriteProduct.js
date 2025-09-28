const mongoose = require('mongoose');

const FavoriteProductSchema = new mongoose.Schema({
  // Kullanıcı bilgisi - eski schema ile uyumlu
  user: {
    type: String,
    required: [true, 'User is required'],
    trim: true
    // index: true kaldırıldı
  },
  
  // Ürün bilgileri - SOAP'tan gelen
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
    default: 0
  },
  
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
  }
}, {
  timestamps: true,
  collection: 'favoriteProducts'
});

// Index'leri ayrı olarak tanımla
FavoriteProductSchema.index({ user: 1, stkno: 1 }, { unique: true, name: 'user_stkno_unique' });
FavoriteProductSchema.index({ user: 1, createdAt: -1 }, { name: 'user_created_desc' });

// Static metodlar - user field'ını kullan
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