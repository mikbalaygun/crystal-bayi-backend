const cron = require('node-cron');
const logger = require('./utils/logger');
const { deltaSync } = require('./services/productSyncService');
const { syncProductImages } = require('./services/imageSyncService');

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

function scheduleImageSync() {
  if (process.env.ENABLE_IMAGE_CRON !== 'true') {
    logger.warn('[CRON] Image sync disabled (ENABLE_IMAGE_CRON !== true)');
    return;
  }

  const expr = process.env.IMAGE_CRON_EXPR || '0 0 2 * * *'; // her gün saat 02:00
  const tz = process.env.TZ || 'Europe/Istanbul';

  logger.info(`[CRON] Scheduling image sync | expr="${expr}" | tz="${tz}"`);

  cron.schedule(
    expr,
    async () => {
      try {
        logger.info('[CRON] Image sync started');
        const res = await syncProductImages();
        logger.info('[CRON] Image sync finished', res);
      } catch (err) {
        logger.error('[CRON] Image sync failed', { error: err.message });
      }
    },
    { timezone: tz }
  );
}

module.exports = { scheduleProductSync, scheduleImageSync };