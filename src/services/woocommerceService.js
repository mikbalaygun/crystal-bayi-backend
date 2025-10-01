const axios = require('axios');
const logger = require('../utils/logger');

const WC_SITE_URL = process.env.WC_SITE_URL || 'https://kristal.com.tr/wp-json/wc/v3';
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;

class WooCommerceService {
  constructor() {
    if (!WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
      logger.warn('WooCommerce credentials not found in environment variables');
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.client = axios.create({
      baseURL: WC_SITE_URL,
      auth: {
        username: WC_CONSUMER_KEY,
        password: WC_CONSUMER_SECRET
      },
      timeout: 30000
    });
  }

  async getAllProducts() {
    if (!this.enabled) {
      throw new Error('WooCommerce service is not enabled');
    }

    const products = [];
    let page = 1;
    const perPage = 100;

    try {
      while (true) {
        logger.info(`Fetching WooCommerce products page ${page}`);
        
        const response = await this.client.get('/products', {
          params: {
            per_page: perPage,
            page: page,
            _fields: 'id,name,sku,images'
          }
        });

        const items = response.data;
        
        if (!items || items.length === 0) break;
        
        products.push(...items);
        
        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1');
        if (page >= totalPages) break;
        
        page++;

        // Rate limiting için 500ms bekle
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`Total WooCommerce products fetched: ${products.length}`);
      return products;
    } catch (error) {
      logger.error('WooCommerce API error:', {
        message: error.message,
        response: error.response?.data
      });
      throw error;
    }
  }

  async getProductBySku(sku) {
    if (!this.enabled) return null;

    try {
      const response = await this.client.get('/products', {
        params: {
          sku: sku,
          _fields: 'id,name,sku,images'
        }
      });
      
      return response.data[0] || null;
    } catch (error) {
      logger.error(`WooCommerce get product error for SKU ${sku}:`, error.message);
      return null;
    }
  }
}

module.exports = new WooCommerceService();