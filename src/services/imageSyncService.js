const Product = require('../models/Product');
const woocommerceService = require('./woocommerceService');
const logger = require('../utils/logger');

async function syncProductImages() {
  try {
    logger.info('Starting product image sync from WooCommerce');

    // WooCommerce'den tüm ürünleri çek
    const wcProducts = await woocommerceService.getAllProducts();
    
    // SKU -> Image URL mapping
    const imageMap = new Map();
    wcProducts.forEach(wc => {
      if (wc.sku && wc.images && wc.images.length > 0) {
        imageMap.set(wc.sku, {
          url: wc.images[0].src,
          name: wc.name
        });
      }
    });

    logger.info(`WooCommerce image map created: ${imageMap.size} products with images`);

    // MongoDB'deki ürünleri batch'ler halinde güncelle
    const BATCH_SIZE = 500;
    let updateCount = 0;
    let notFoundCount = 0;

    const mongoProducts = await Product.find({ isActive: { $ne: false } })
      .select('stkno imageUrl')
      .lean();
    
    const bulkOps = [];
    
    for (const product of mongoProducts) {
      const wcData = imageMap.get(product.stkno);
      
      if (wcData) {
        bulkOps.push({
          updateOne: {
            filter: { stkno: product.stkno },
            update: { 
              $set: {
                imageUrl: wcData.url,
                imageSource: 'woocommerce',
                imageSyncedAt: new Date()
              }
            }
          }
        });
        updateCount++;
      } else {
        notFoundCount++;
      }

      // Batch dolunca işle
      if (bulkOps.length >= BATCH_SIZE) {
        await Product.bulkWrite(bulkOps, { ordered: false });
        logger.info(`Processed batch: ${bulkOps.length} images updated`);
        bulkOps.length = 0; // Array'i temizle
      }
    }

    // Kalan batch'i işle
    if (bulkOps.length > 0) {
      await Product.bulkWrite(bulkOps, { ordered: false });
      logger.info(`Processed final batch: ${bulkOps.length} images updated`);
    }

    logger.info('Product image sync completed', {
      totalWC: wcProducts.length,
      totalMongo: mongoProducts.length,
      updated: updateCount,
      notFound: notFoundCount
    });

    return {
      success: true,
      wcProducts: wcProducts.length,
      mongoProducts: mongoProducts.length,
      updated: updateCount,
      notFound: notFoundCount
    };
  } catch (error) {
    logger.error('Image sync failed:', error);
    throw error;
  }
}

module.exports = { syncProductImages };