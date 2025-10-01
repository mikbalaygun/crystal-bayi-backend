const crypto = require('crypto');
const Product = require('../models/Product');
const Category = require('../models/Category');
const SyncCursor = require('../models/SyncCursor');
const soapService = require('./soapService');
const currencyService = require('./currencyService');
const logger = require('../utils/logger');

function checksumOf(p) {
  const prices = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
    .map(i => p[`fiyat${i}`] || 0)
    .join('|');
  const base = `${p.stkno}|${p.stokadi}|${prices}|${p.bakiye ?? ''}|${p.grupadi ?? ''}|${p.cinsi ?? ''}`;
  return crypto.createHash('md5').update(base).digest('hex');
}

async function fetchAllErpProducts() {
  logger.info('Attempting to fetch products with ikoStoklist');
  
  const ikoProducts = await soapService.getProductsWithAllPrices();
  
  if (ikoProducts && ikoProducts.length > 0) {
    logger.info(`Using ikoStoklist - got ${ikoProducts.length} products`);
    return ikoProducts;
  }
  
  logger.warn('ikoStoklist returned 0 products, falling back to slStoklist');
  const list = await soapService.getProducts('07748', {});
  
  if (list.length > 0) {
    logger.info('Sample product fields from slStoklist:', {
      allFields: Object.keys(list[0]),
      sampleProduct: list[0]
    });
  }
  
  return Array.isArray(list) ? list : (list ? [list] : []);
}

async function upsertProducts(products = []) {
  if (!products.length) return { inserted: 0, updated: 0 };

  logger.info('Getting currency rates for conversion...');
  const usdRate = await currencyService.getRate('USD');
  const eurRate = await currencyService.getRate('EUR');
  
  logger.info(`Using rates: USD=${usdRate}, EUR=${eurRate}`);

  const BATCH_SIZE = 500;
  let totalInserted = 0;
  let totalUpdated = 0;
  let currencyStats = { USD: 0, EUR: 0, TRY: 0 };

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    
    const ops = batch.map(p => {
      const bakiye = Number(p.bakiye ?? p.bky ?? p.stok ?? 0);
      const currency = (p.cinsi?.trim().toUpperCase() || 'TRY');
      
      // İstatistik
      currencyStats[currency] = (currencyStats[currency] || 0) + 1;
      
      // Orijinal fiyatları sakla
      const originalPriceList = {};
      const priceList = {};
      
      for (let j = 1; j <= 15; j++) {
        const originalPrice = Number(p[`fiyat${j}`] ?? 0);
        originalPriceList[`fiyat${j}`] = originalPrice;
        
        // TL'ye çevir
        let convertedPrice = originalPrice;
        if (currency === 'USD') {
          convertedPrice = originalPrice * usdRate;
        } else if (currency === 'EUR') {
          convertedPrice = originalPrice * eurRate;
        }
        
        priceList[`fiyat${j}`] = Math.round(convertedPrice * 100) / 100; // 2 ondalık
      }
      
      const doc = {
        stkno: p.stkno,
        stokadi: p.stokadi,
        grupadi: p.grupadi,
        priceList,           // TL cinsinden fiyatlar
        originalPriceList,   // Orijinal fiyatlar
        cinsi: currency,
        bakiye,
        birim: p.birim || 'ADET',
        kdv: p.kdv || 18,
        uruntipi: p.uruntipi || '',
        fgrp: p.fgrp || '',
        fagrp: p.fagrp || '',
        fatgrp: p.fatgrp || '',
        isActive: true,
        checksum: checksumOf(p),
        syncedAt: new Date(),
        _raw: p
      };
      
      return {
        updateOne: {
          filter: { stkno: p.stkno },
          update: { 
            $set: doc,
            // Image alanlarını sadece insert'te ekle, update'te dokunma
            $setOnInsert: {
              imageUrl: null,
              imageSource: null,
              imageSyncedAt: null
            }
          },
          upsert: true
        }
      };
    });

    try {
      const res = await Product.bulkWrite(ops, { ordered: false });
      totalInserted += res.upsertedCount || 0;
      totalUpdated += res.modifiedCount || 0;
      
      logger.info(`Batch ${Math.floor(i/BATCH_SIZE) + 1} completed: ${batch.length} products processed`);
    } catch (error) {
      logger.error(`Batch ${Math.floor(i/BATCH_SIZE) + 1} failed:`, error.message);
      throw error;
    }
  }

  logger.info('Currency conversion statistics:', currencyStats);
  return { inserted: totalInserted, updated: totalUpdated };
}

async function syncCategories() {
  logger.info('Starting category sync');
  
  try {
    const mainGroups = await soapService.getProductGroups();
    const categoryOps = [];
    
    for (const group of mainGroups) {
      categoryOps.push({
        updateOne: {
          filter: { grpkod: group.grpkod },
          update: {
            $set: {
              grpkod: group.grpkod,
              grpadi: group.grpadi,
              level: 1,
              parentId: null,
              isActive: true,
              syncedAt: new Date(),
              _raw: group
            }
          },
          upsert: true
        }
      });
      
      try {
        const subGroups = await soapService.getSubGroups(group.grpkod);
        for (const subGroup of subGroups) {
          categoryOps.push({
            updateOne: {
              filter: { grpkod: subGroup.altgrpkod || subGroup.grpkod },
              update: {
                $set: {
                  grpkod: subGroup.altgrpkod || subGroup.grpkod,
                  grpadi: subGroup.altgrpadi || subGroup.grpadi,
                  level: 2,
                  parentId: group.grpkod,
                  isActive: true,
                  syncedAt: new Date(),
                  _raw: subGroup
                }
              },
              upsert: true
            }
          });
          
          try {
            const subGroups2 = await soapService.getSubGroups2(subGroup.altgrpkod || subGroup.grpkod);
            for (const subGroup2 of subGroups2) {
              categoryOps.push({
                updateOne: {
                  filter: { grpkod: subGroup2.altgrpkod2 || subGroup2.grpkod },
                  update: {
                    $set: {
                      grpkod: subGroup2.altgrpkod2 || subGroup2.grpkod,
                      grpadi: subGroup2.altgrpadi2 || subGroup2.grpadi,
                      level: 3,
                      parentId: subGroup.altgrpkod || subGroup.grpkod,
                      isActive: true,
                      syncedAt: new Date(),
                      _raw: subGroup2
                    }
                  },
                  upsert: true
                }
              });
            }
          } catch (error) {
            logger.warn(`Failed to fetch subgroups2 for ${subGroup.altgrpkod}: ${error.message}`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch subgroups for ${group.grpkod}: ${error.message}`);
      }
    }
    
    if (categoryOps.length > 0) {
      const result = await Category.bulkWrite(categoryOps, { ordered: false });
      logger.info(`Category sync completed: ${result.upsertedCount} inserted, ${result.modifiedCount} updated`);
      return { inserted: result.upsertedCount, updated: result.modifiedCount };
    }
    
    return { inserted: 0, updated: 0 };
    
  } catch (error) {
    logger.error('Category sync failed:', error);
    throw error;
  }
}

async function fullSync() {
  logger.info('Starting FULL sync');
  
  const all = await fetchAllErpProducts();
  const productResult = await upsertProducts(all);
  
  let categoryResult = { inserted: 0, updated: 0 };
  try {
    categoryResult = await syncCategories();
  } catch (catError) {
    logger.warn('Category sync failed, continuing without categories', {
      error: catError.message
    });
  }
  
  await SyncCursor.updateOne(
    { key: 'products' },
    { 
      $set: { 
        lastSuccessfulSyncAt: new Date(),
        lastSyncMode: 'full'
      } 
    },
    { upsert: true }
  );
  
  logger.info(`FULL sync completed | products: ${all.length} (${productResult.inserted}+${productResult.updated}) | categories: ${categoryResult.inserted}+${categoryResult.updated}`);
  return { 
    products: { total: all.length, ...productResult },
    categories: categoryResult
  };
}

async function deltaSync() {
  logger.info('Starting DELTA sync');
  
  const all = await fetchAllErpProducts();
  const productResult = await upsertProducts(all);
  
  let categoryResult = { inserted: 0, updated: 0 };
  try {
    categoryResult = await syncCategories();
  } catch (catError) {
    logger.warn('Category sync failed, continuing without categories', {
      error: catError.message
    });
  }

  await SyncCursor.updateOne(
    { key: 'products' },
    { 
      $set: { 
        lastSuccessfulSyncAt: new Date(),
        lastSyncMode: 'delta'
      } 
    },
    { upsert: true }
  );
  
  logger.info(`DELTA sync completed | products: ${all.length} (${productResult.inserted}+${productResult.updated}) | categories: ${categoryResult.inserted}+${categoryResult.updated}`);
  return { 
    products: { fetched: all.length, ...productResult },
    categories: categoryResult
  };
}

module.exports = { fullSync, deltaSync, syncCategories };