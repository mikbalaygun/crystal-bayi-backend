// src/services/soapService.js
const soap = require('soap');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

class SoapService {
  constructor() {
    this.client = null;
    this.wsdl = process.env.SOAP_KRISTAL_WSDL;
    this.endpoint = process.env.SOAP_KRISTAL_ENDPOINT;
  }

  // --- helpers ---
  toNumber(n, def = 0) {
    const v = Number(n);
    return Number.isFinite(v) ? v : def;
  }

  normalizeCurrency(code) {
    const c = String(code || 'TRY').toUpperCase().trim();
    // ERP'ye TL göndereceğiz; burada sadece sınıflandırma için kullanıyoruz
    if (c === 'TL') return 'TL';
    if (c === 'TRY') return 'TRY';
    if (['USD', 'EUR', 'GBP'].includes(c)) return c;
    return c; // diğerleri
  }

  async createClient() {
    try {
      if (!this.client) {
        logger.soap('Creating SOAP client', { wsdl: this.wsdl });

        this.client = await soap.createClientAsync(this.wsdl, {
          timeout: 30000,
          connectionTimeout: 10000
        });

        this.client.setEndpoint(this.endpoint);

        logger.info('✅ SOAP client created successfully');
        logger.info('📋 Available SOAP methods:', {
          methods: Object.keys(this.client).filter(key =>
            typeof this.client[key] === 'function' && !key.startsWith('_')
          )
        });
      }

      return this.client;
    } catch (error) {
      logger.error('❌ SOAP client creation failed:', error);
      this.client = null;
      throw new AppError('SOAP service unavailable', 503);
    }
  }

  async callSoapMethod(methodName, params = {}, retries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const client = await this.createClient();
        logger.soap(`Calling ${methodName} (attempt ${attempt})`, params);
        const result = await client[methodName + 'Async'](params);
        logger.info(`✅ SOAP ${methodName} successful`, {
          method: methodName,
          attempt,
          hasResult: !!result
        });
        return result;
      } catch (error) {
        lastError = error;
        logger.error(`❌ SOAP ${methodName} failed (attempt ${attempt}):`, {
          error: error.message,
          method: methodName,
          attempt,
          params
        });
        this.client = null;
        if (error.message.includes('authentication') || error.message.includes('login')) {
          break;
        }
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw new AppError(`SOAP ${methodName} failed: ${lastError?.message || 'Unknown error'}`, 503);
  }

  // AUTHENTICATION
  async authenticateUser(username, password) {
    try {
      const result = await this.callSoapMethod('uuselogin', {
        uulogin: username,
        uucyrpt: password
      });

      if (!result || !result[0] || !result[0].uucust) {
        throw new AppError('Invalid credentials', 401);
      }

      const response = result[0];
      const vinfo = response.vinfo ? response.vinfo.split('|') : [];

      return {
        success: true,
        user: {
          company: response.uucust,
          list: response.uliste,
          username: username,
          hesap: username,
          type: 'customer',
          email: vinfo[0] || '',
          phone2: vinfo[1] || '',
          phone: vinfo[2] || '',
          ulke: vinfo[3] || '',
          sehir: vinfo[4] || '',
          ilce: vinfo[5] || '',
          adres: vinfo[6] || '',
          vName: vinfo[7] || '',
          vNo: vinfo[8] || '',
          vurun: vinfo[10] || '',
          bakiye: vinfo[11] || '0'
        }
      };
    } catch (error) {
      logger.error('Authentication failed:', error);
      throw new AppError('Authentication failed', 401);
    }
  }

  // PRODUCTS - slStoklist metodunu kaldırdık (artık kullanılmayacak)

  async getProductsWithAllPrices() {
    try {
      logger.info('Calling ikoStoklist (multi-price list)');

      const result = await this.callSoapMethod('ikoStoklist', {});

      if (!result || !result[0]) {
        logger.error('❌ ikoStoklist returned empty result');
        throw new AppError('ikoStoklist returned empty result', 500);
      }

      // TTStoklar içinde TTStoklarRow var
      const products = result[0]?.TTStoklar?.TTStoklarRow || [];
      const count = Array.isArray(products) ? products.length : (products ? 1 : 0);

      if (count === 0) {
        logger.error('❌ ikoStoklist returned 0 products');
        throw new AppError('ikoStoklist returned 0 products', 500);
      }

      logger.info(`✅ ikoStoklist returned ${count} products with 15 price lists`);

      if (count > 0) {
        const firstProduct = Array.isArray(products) ? products[0] : products;
        logger.info('Sample product from ikoStoklist:', {
          stkno: firstProduct.stkno,
          stokadi: firstProduct.stokadi,
          hasPrices: !!(firstProduct.fiyat1 && firstProduct.fiyat2),
          fiyat1: firstProduct.fiyat1,
          fiyat15: firstProduct.fiyat15,
          cinsi: firstProduct.cinsi
        });
      }

      return Array.isArray(products) ? products : [products];

    } catch (error) {
      logger.error('❌ CRITICAL: Failed to fetch products with all prices:', error.message);
      throw new AppError('Failed to fetch products with all prices', 500);
    }
  }

  async getProductGroups() {
    try {
      const result = await this.callSoapMethod('urungruplari', {});
      const groups = result[0]?.urungruplari?.urungruplariRow || [];
      return Array.isArray(groups) ? groups : [groups];
    } catch (error) {
      logger.error('Failed to fetch product groups:', error);
      throw new AppError('Failed to fetch product groups', 500);
    }
  }

  async getSubGroups(groupId) {
    try {
      const result = await this.callSoapMethod('altgrup', { vgrup: groupId });
      const subGroups = result[0]?.altgrup?.altgrupRow || [];
      return Array.isArray(subGroups) ? subGroups : [subGroups];
    } catch (error) {
      logger.error(`Failed to fetch sub groups for ${groupId}:`, error);
      throw new AppError('Failed to fetch sub groups', 500);
    }
  }

  async getSubGroups2(groupId) {
    try {
      const result = await this.callSoapMethod('altgrup2', { vgrup: groupId });
      const subGroups = result[0]?.altgrup2?.altgrup2Row || [];
      return Array.isArray(subGroups) ? subGroups : [subGroups];
    } catch (error) {
      logger.error(`Failed to fetch sub groups2 for ${groupId}:`, error);
      throw new AppError('Failed to fetch sub groups2', 500);
    }
  }

  // ORDERS
  async getOrders(userHesap, dateFilters = {}) {
    try {
      const params = {
        vhesap: userHesap,
        vilktar: dateFilters.startDate || '',
        vsontar: dateFilters.endDate || ''
      };
      const result = await this.callSoapMethod('rsiparisler', params);
      if (!result || !result[0]) return [];
      const orders = result[0]?.TTsiparis?.TTsiparisRow || [];
      logger.info(`Fetched ${Array.isArray(orders) ? orders.length : 1} orders for user ${userHesap}`);
      return Array.isArray(orders) ? orders : [orders];
    } catch (error) {
      logger.error('Failed to fetch orders:', error);
      if (error.message.includes('TTsiparisRow')) return [];
      throw new AppError('Failed to fetch orders', 500);
    }
  }

  /**
   * İSTENEN DAVRANIŞ:
   * - TL gelen ürünlerde: wsipfyt = product.fiyat (TL), wcinsi = 'TL'
   * - USD/EUR (ve diğer yabancı) gelen ürünlerde: wsipfyt = product.fiyatTL (TL'ye çevrilmiş),
   *   wcinsi = 'TL'
   * Not: fiyatTL yoksa güvenli fallback olarak product.fiyat kullanıyoruz.
   * (İsterseniz bu fallback'i kaldırıp 400 hata döndürtebiliriz.)
   */
  async createOrder(userHesap, products) {
    try {
      const moment = require('moment');

      const orderProducts = products.map((product) => {
        const adet = this.toNumber(product.adet, 0);
        const cinsi = this.normalizeCurrency(product.cinsi);
        const isFx = !['TL', 'TRY'].includes(cinsi); // TL/TRY dışı (USD/EUR/GBP vs.)

        // TL ürünlerde orijinal TL fiyatı; yabancı para ürünlerde TL karşılığı (fiyatTL)
        const unitTL = isFx
          ? (this.toNumber(product.fiyatTL, NaN)) // fiyatTL bekleniyor
          : this.toNumber(product.fiyat, 0);      // native TL

        // fiyatTL yoksa güvenli fallback
        const safeUnitTL = Number.isFinite(unitTL) ? unitTL : this.toNumber(product.fiyat, 0);

        return {
          wcinsi: 'TL',                                      // ERP 'TL' istiyor
          wstkno: product.stkno,
          wsipmik: adet,
          wsipfyt: Number(safeUnitTL.toFixed(4)),            // TL birim fiyat
          wtermin: moment().format('DD-MM-YYYY'),
          wsiptut: Number((safeUnitTL * adet).toFixed(4)),   // TL toplam
          wacik: isFx ? 'WEB (TL via fiyatTL)' : 'WEB',
          wsipisktut: 0,
          wsipisk1: 0,
          wsipisk2: 0,
          wsipisk3: 0
        };
      });

      const params = {
        vhesap: userHesap,
        TTcreasip: { TTcreasipRow: orderProducts }
      };

      const result = await this.callSoapMethod('sipcrea', params);
      logger.info(`✅ Order created successfully for user ${userHesap}`, {
        productCount: products.length,
        currenciesBefore: [...new Set(products.map(p => (p.cinsi || '').toString().toUpperCase()))],
        currencySent: 'TL',
        usedTLSource: [...new Set(orderProducts.map(p => p.wacik.includes('(TL via fiyatTL)') ? 'fiyatTL' : 'nativeTL'))],
        result
      });

      return {
        success: true,
        orderId: result[0]?.sipno || 'Generated',
        message: 'Order created successfully'
      };
    } catch (error) {
      logger.error('❌ Failed to create order:', error);
      throw new AppError('Failed to create order', 500);
    }
  }

  // EXTRACT
  async getExtract(userHesap, dateFilters = {}) {
    try {
      const moment = require('moment');
      const params = {
        vhesap: userHesap,
        vilktar: dateFilters.startDate || moment().startOf('year').format('DD-MM-YYYY'),
        vsontar: dateFilters.endDate || moment().format('DD-MM-YYYY')
      };
      const result = await this.callSoapMethod('dgeks', params);
      const extract = result[0]?.TTekstre?.TTekstreRow || [];
      return Array.isArray(extract) ? extract : [extract];
    } catch (error) {
      logger.error('Failed to fetch extract:', error);
      throw new AppError('Failed to fetch extract', 500);
    }
  }

  async getExtractDetail(fkn) {
    if (!fkn && fkn !== 0) {
      throw new AppError('Extract detail id (fkn) is required', 400);
    }
    try {
      const result = await this.callSoapMethod('cardetstk', { vfkn: fkn });
      let rows = result?.[0]?.TTfkndet?.TTfkndetRow || [];
      return Array.isArray(rows) ? rows : [rows];
    } catch (error) {
      logger.error('Failed to fetch extract detail:', error);
      throw new AppError('Failed to fetch extract detail', 500);
    }
  }

  // CUSTOMERS
  async getCustomers() {
    try {
      const result = await this.callSoapMethod('slCustlist', {});
      const customers = result[0]?.ttCust?.ttCustRow || [];
      return Array.isArray(customers) ? customers : [customers];
    } catch (error) {
      logger.error('Failed to fetch customers:', error);
      throw new AppError('Failed to fetch customers', 500);
    }
  }

  // UTILITY
  async healthCheck() {
    try {
      await this.createClient();
      return { status: 'OK', timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        status: 'ERROR',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  resetConnection() {
    this.client = null;
    logger.info('SOAP client connection reset');
  }
}

module.exports = new SoapService();
