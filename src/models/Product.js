const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  stkno: { type: String, required: true, unique: true },
  stokadi: { type: String },
  grupadi: { type: String },
  
  // Fiyat listelerini object olarak sakla
  priceList: {
    fiyat1: { type: Number, default: 0 },
    fiyat2: { type: Number, default: 0 },
    fiyat3: { type: Number, default: 0 },
    fiyat4: { type: Number, default: 0 },
    fiyat5: { type: Number, default: 0 },
    fiyat6: { type: Number, default: 0 },
    fiyat7: { type: Number, default: 0 },
    fiyat8: { type: Number, default: 0 },
    fiyat9: { type: Number, default: 0 },
    fiyat10: { type: Number, default: 0 },
    fiyat11: { type: Number, default: 0 },
    fiyat12: { type: Number, default: 0 },
    fiyat13: { type: Number, default: 0 },
    fiyat14: { type: Number, default: 0 },
    fiyat15: { type: Number, default: 0 }
  },
  originalPriceList: {
    fiyat1: { type: Number, default: 0 },
    fiyat2: { type: Number, default: 0 },
    fiyat3: { type: Number, default: 0 },
    fiyat4: { type: Number, default: 0 },
    fiyat5: { type: Number, default: 0 },
    fiyat6: { type: Number, default: 0 },
    fiyat7: { type: Number, default: 0 },
    fiyat8: { type: Number, default: 0 },
    fiyat9: { type: Number, default: 0 },
    fiyat10: { type: Number, default: 0 },
    fiyat11: { type: Number, default: 0 },
    fiyat12: { type: Number, default: 0 },
    fiyat13: { type: Number, default: 0 },
    fiyat14: { type: Number, default: 0 },
    fiyat15: { type: Number, default: 0 }
  },
  
  cinsi: { type: String, default: 'TRY' },
  bakiye: { type: Number, default: 0 },
  birim: { type: String, default: 'ADET' },
  kdv: { type: Number, default: 18 },
  uruntipi: { type: String, default: '' },
  fgrp: { type: String, default: '' },
  fagrp: { type: String, default: '' },
  fatgrp: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  checksum: { type: String },
  syncedAt: { type: Date },
  
  imageUrl: { type: String, default: null },
  imageSource: { type: String, enum: ['woocommerce', 'manual', null], default: null },
  imageSyncedAt: { type: Date, default: null },
  
  _raw: mongoose.Schema.Types.Mixed
}, { timestamps: true });

ProductSchema.index({ stokadi: 1 });
ProductSchema.index({ grupadi: 1 });

ProductSchema.index(
  { stokadi: 'text', stkno: 'text', grupadi: 'text' },
  { weights: { stkno: 8, stokadi: 5, grupadi: 2 }, default_language: 'turkish' }
);

module.exports = mongoose.model('Product', ProductSchema);