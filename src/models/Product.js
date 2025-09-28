const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  stkno: { type: String, required: true, unique: true }, // index: true kaldırıldı
  stokadi: { type: String }, // index: true kaldırıldı - aşağıda text index var
  grupadi: { type: String }, // index: true kaldırıldı - aşağıda text index var
  fiyat: { type: Number, default: 0 },
  cinsi: { type: String, default: 'TRY' }, // Para birimi
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
  _raw: mongoose.Schema.Types.Mixed
}, { timestamps: true });

// Index'leri ayrı tanımla
ProductSchema.index({ stokadi: 1 }); // Arama için
ProductSchema.index({ grupadi: 1 }); // Kategori filtreleme için

// Text search index
ProductSchema.index(
  { stokadi: 'text', stkno: 'text', grupadi: 'text' },
  { weights: { stkno: 8, stokadi: 5, grupadi: 2 }, default_language: 'turkish' }
);

module.exports = mongoose.model('Product', ProductSchema);