const crypto = require('crypto');
const Product = require('../models/Product');
const Category = require('../models/Category');
const SyncCursor = require('../models/SyncCursor');
const soapService = require('./soapService');
const logger = require('../utils/logger');

const SYNC_HESAP = process.env.SYNC_HESAP || '07748';

function checksumOf(p) {
  const base = `${p.stkno}|${p.stokadi}|${p.fiyat ?? p.fiy ?? ''}|${p.bakiye ?? ''}|${p.grupadi ?? ''}|${p.cinsi ?? ''}`;
  return crypto.createHash('md5').update(base).digest('hex');
}

async function fetchAllErpProducts() {
  logger.info(`Fetching all products from ERP using sync account: ${SYNC_HESAP}`);
  const list = await soapService.getProducts(SYNC_HESAP, {});
  return Array.isArray(list) ? list : (list ? [list] : []);
}

async function upsertProducts(products = []) {
  if (!products.length) return { inserted: 0, updated: 0 };

  const BATCH_SIZE = 500; // Küçük batch'ler halinde işle
  let totalInserted = 0;
  let totalUpdated = 0;

  // Batch'ler halinde işle
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    
    const ops = batch.map(p => {
      const fiyat = Number(p.fiyat ?? p.fiy ?? 0);
      const bakiye = Number(p.bakiye ?? p.bky ?? p.stok ?? 0);
      
      // Para birimi field'ını kontrol et
      let cinsi = 'TRY'; // Default değer
      if (p.cinsi) {
        // SOAP'tan gelen cinsi değerini temizle
        const cleanCinsi = String(p.cinsi).trim().toUpperCase();
        if (cleanCinsi && cleanCinsi !== '' && cleanCinsi !== 'NULL') {
          cinsi = cleanCinsi;
        }
      }
      
      const doc = {
        stkno: p.stkno,
        stokadi: p.stokadi,
        grupadi: p.grupadi,
        fiyat,
        cinsi, // ← YENİ FIELD EKLENDİ
        bakiye,
        birim: p.birim || 'ADET',
        kdv: p.kdv || 18,
        uruntipi: p.uruntipi || '',
        fgrp: p.fgrp || '',
        fagrp: p.fagrp || '',
        fatgrp: p.fatgrp || '',
        isActive: true,
        checksum: checksumOf({ ...p, fiyat, bakiye }),
        syncedAt: new Date(),
        _raw: p
      };
      return {
        updateOne: {
          filter: { stkno: p.stkno },
          update: { $set: doc },
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

  return {
    inserted: totalInserted,
    updated: totalUpdated
  };
}

async function syncCategories() {
  logger.info('Starting category sync');
  
  try {
    // Ana grupları çek
    const mainGroups = await soapService.getProductGroups();
    
    const categoryOps = [];
    
    // Ana grupları işle
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
      
      // Alt grupları çek (level 2)
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
          
          // Alt gruplar2 çek (level 3)
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
  logger.info(`Starting FULL sync with account: ${SYNC_HESAP}`);
  
  // Ürün sync
  const all = await fetchAllErpProducts();
  const productResult = await upsertProducts(all);
  
  // Kategori sync
  const categoryResult = await syncCategories();
  
  await SyncCursor.updateOne(
    { key: 'products' },
    { 
      $set: { 
        lastSuccessfulSyncAt: new Date(),
        lastSyncMode: 'full',
        syncAccount: SYNC_HESAP
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
  logger.info(`Starting DELTA sync with account: ${SYNC_HESAP}`);
  
  // Ürün sync
  const all = await fetchAllErpProducts();
  const productResult = await upsertProducts(all);
  
  // Kategori sync (delta'da da çalıştır)
  const categoryResult = await syncCategories();

  await SyncCursor.updateOne(
    { key: 'products' },
    { 
      $set: { 
        lastSuccessfulSyncAt: new Date(),
        lastSyncMode: 'delta',
        syncAccount: SYNC_HESAP
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