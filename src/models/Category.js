// models/Category.js
const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  grpkod: { type: String, required: true, unique: true, index: true },
  grpadi: { type: String, required: true, index: true },
  level: { type: Number, default: 1 }, // 1: ana grup, 2: alt grup, 3: alt grup2
  parentId: { type: String, default: null }, // üst kategori referansı
  isActive: { type: Boolean, default: true },
  syncedAt: { type: Date, default: Date.now },
  _raw: mongoose.Schema.Types.Mixed
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);