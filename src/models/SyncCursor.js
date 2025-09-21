const mongoose = require('mongoose');

const SyncCursorSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  lastSuccessfulSyncAt: { type: Date },
  lastSyncMode: { type: String },
  syncAccount: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('SyncCursor', SyncCursorSchema);