const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  grpkod: { type: String, required: true, unique: true }, // index: true kaldırıldı
  grpadi: { type: String, required: true }, // index: true kaldırıldı
  level: { type: Number, default: 1 }, // 1: ana grup, 2: alt grup, 3: alt grup2
  parentId: { type: String, default: null }, // üst kategori referansı
  isActive: { type: Boolean, default: true },
  syncedAt: { type: Date, default: Date.now },
  _raw: mongoose.Schema.Types.Mixed
}, { timestamps: true });

// Index'leri ayrı tanımla
CategorySchema.index({ grpadi: 1 }); // Arama için
CategorySchema.index({ level: 1, parentId: 1 }); // Hiyerarşi için
CategorySchema.index({ isActive: 1 }); // Aktif kategoriler için

module.exports = mongoose.model('Category', CategorySchema);