const soap = require('soap');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

class SoapService {
  constructor() {
    this.client = null;
    this.wsdl = process.env.SOAP_KRISTAL_WSDL;
    this.endpoint = process.env.SOAP_KRISTAL_ENDPOINT;
  }

  // Create SOAP client with error handling and retry logic
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
      }

      return this.client;
    } catch (error) {
      logger.error('❌ SOAP client creation failed:', error);
      this.client = null;
      throw new AppError('SOAP service unavailable', 503);
    }
  }

  // Generic SOAP operation wrapper with error handling
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

        // Reset client on error for next attempt
        this.client = null;

        // Don't retry on authentication errors
        if (error.message.includes('authentication') || error.message.includes('login')) {
          break;
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw new AppError(`SOAP ${methodName} failed: ${lastError?.message || 'Unknown error'}`, 503);
  }

  // ===============================
  // AUTHENTICATION METHODS
  // ===============================

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

  // ===============================
  // PRODUCT METHODS
  // ===============================

  async getProducts(userHesap, filters = {}) {
    try {
      const params = {
        vhesap: userHesap,
        vanagrup: filters.fgrp || '',
        valtgrup: filters.fagrp === 'undefined' ? '' : (filters.fagrp || ''),
        valtgrup2: filters.fatgrp === 'undefined' ? '' : (filters.fatgrp || '')
      };

      const result = await this.callSoapMethod('slStoklist', params);

      if (!result || !result[0]) {
        return [];
      }

      const products = result[0]?.TTStok?.TTStokRow || [];

      logger.info(`Fetched ${products.length} products for user ${userHesap}`);

      return Array.isArray(products) ? products : [products];

    } catch (error) {
      logger.error('Failed to fetch products:', error);
      throw new AppError('Failed to fetch products', 500);
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
      const result = await this.callSoapMethod('altgrup', {
        vgrup: groupId
      });

      const subGroups = result[0]?.altgrup?.altgrupRow || [];

      return Array.isArray(subGroups) ? subGroups : [subGroups];

    } catch (error) {
      logger.error(`Failed to fetch sub groups for ${groupId}:`, error);
      throw new AppError('Failed to fetch sub groups', 500);
    }
  }

  async getSubGroups2(groupId) {
    try {
      const result = await this.callSoapMethod('altgrup2', {
        vgrup: groupId
      });

      const subGroups = result[0]?.altgrup2?.altgrup2Row || [];

      return Array.isArray(subGroups) ? subGroups : [subGroups];

    } catch (error) {
      logger.error(`Failed to fetch sub groups2 for ${groupId}:`, error);
      throw new AppError('Failed to fetch sub groups2', 500);
    }
  }

  // ===============================
  // ORDER METHODS
  // ===============================

  async getOrders(userHesap, dateFilters = {}) {
    try {
      const params = {
        vhesap: userHesap,
        vilktar: dateFilters.startDate || '',
        vsontar: dateFilters.endDate || ''
      };

      const result = await this.callSoapMethod('rsiparisler', params);

      if (!result || !result[0]) {
        return [];
      }

      const orders = result[0]?.TTsiparis?.TTsiparisRow || [];

      logger.info(`Fetched ${Array.isArray(orders) ? orders.length : 1} orders for user ${userHesap}`);

      return Array.isArray(orders) ? orders : [orders];

    } catch (error) {
      logger.error('Failed to fetch orders:', error);
      // Don't throw error if no orders found
      if (error.message.includes('TTsiparisRow')) {
        return [];
      }
      throw new AppError('Failed to fetch orders', 500);
    }
  }

  async createOrder(userHesap, products) {
    try {
      const moment = require('moment');

      const orderProducts = products.map(product => ({
        wcinsi: product.cinsi || 'TL',
        wstkno: product.stkno,
        wsipmik: product.adet,
        wsipfyt: product.fiyat,
        wtermin: moment().format('DD-MM-YYYY'),
        wsiptut: product.fiyat * product.adet,
        wacik: 'WEB',
        wsipisktut: 0,
        wsipisk1: 0,
        wsipisk2: 0,
        wsipisk3: 0
      }));

      const params = {
        vhesap: userHesap,
        TTcreasip: {
          TTcreasipRow: orderProducts
        }
      };

      const result = await this.callSoapMethod('sipcrea', params);

      logger.info(`Order created successfully for user ${userHesap}`, {
        productCount: products.length,
        result
      });

      return {
        success: true,
        orderId: result[0]?.sipno || 'Generated',
        message: 'Order created successfully'
      };

    } catch (error) {
      logger.error('Failed to create order:', error);
      throw new AppError('Failed to create order', 500);
    }
  }

  // ===============================
  // EXTRACT/STATEMENT METHODS
  // ===============================

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

  /**
+   * Ekstre DETAYI: ERP 'cardetstk' ve parametre 'vfkn' bekler.
+   * @param {string|number} fkn - Fiş/Fatura anahtarı (wfkn)
+   * @returns {Array} TTfkndetRow[] (tek kayıt dönerse diziye sarılır)
+   */
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
  // ===============================
  // CUSTOMER METHODS
  // ===============================

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

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Health check for SOAP service
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

  // Reset client connection
  resetConnection() {
    this.client = null;
    logger.info('SOAP client connection reset');
  }
}

// Export singleton instance
module.exports = new SoapService();