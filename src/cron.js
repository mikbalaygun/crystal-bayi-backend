// src/cron.js
const cron = require('node-cron');
const logger = require('./utils/logger');
const { deltaSync } = require('./services/productSyncService');

function scheduleProductSync() {
  if (process.env.ENABLE_PRODUCT_CRON !== 'true') {
    logger.warn('[CRON] Product sync disabled (ENABLE_PRODUCT_CRON !== true)');
    return;
  }

  const expr = process.env.PRODUCT_CRON_EXPR || '0 0 */3 * * *'; // her 3 saatte
  const tz = process.env.TZ || 'Europe/Istanbul';

  logger.info(`[CRON] Scheduling product delta sync | expr="${expr}" | tz="${tz}"`);

  cron.schedule(
    expr,
    async () => {
      try {
        logger.info('[CRON] Product delta sync started');
        const res = await deltaSync(); // ürün + kategori
        logger.info('[CRON] Product delta sync finished', res);
      } catch (err) {
        logger.error('[CRON] Product delta sync failed', { error: err.message });
      }
    },
    { timezone: tz }
  );
}

module.exports = { scheduleProductSync };
