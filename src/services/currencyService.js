const axios = require('axios');
const logger = require('../utils/logger');

class CurrencyService {
  constructor() {
    this.rates = {
      USD: null,
      EUR: null,
      lastUpdate: null
    };
    this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 saat
  }

  /**
   * TCMB'den güncel kurları çek
   */
  async fetchRatesFromTCMB() {
    try {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const url = `https://www.tcmb.gov.tr/kurlar/today.xml`;
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'Accept': 'application/xml' }
      });

      // XML'den USD ve EUR kurlarını parse et
      const xml = response.data;
      
      // USD - ForexSelling (Döviz Satış)
      const usdMatch = xml.match(/<Currency.*?CurrencyCode="USD".*?>(.*?)<\/Currency>/s);
      if (usdMatch) {
        const forexSelling = usdMatch[1].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
        if (forexSelling) {
          this.rates.USD = parseFloat(forexSelling[1]);
        }
      }

      // EUR - ForexSelling
      const eurMatch = xml.match(/<Currency.*?CurrencyCode="EUR".*?>(.*?)<\/Currency>/s);
      if (eurMatch) {
        const forexSelling = eurMatch[1].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
        if (forexSelling) {
          this.rates.EUR = parseFloat(forexSelling[1]);
        }
      }

      this.rates.lastUpdate = new Date();

      logger.info('Currency rates updated from TCMB', {
        USD: this.rates.USD,
        EUR: this.rates.EUR,
        date: this.rates.lastUpdate
      });

      return true;
    } catch (error) {
      logger.error('Failed to fetch rates from TCMB:', error.message);
      
      // Fallback: Manuel kur (güncellenmesi gerekir)
      if (!this.rates.USD || !this.rates.EUR) {
        logger.warn('Using fallback rates from ENV');
        this.rates.USD = parseFloat(process.env.USD_TO_TRY_RATE) || 33.50;
        this.rates.EUR = parseFloat(process.env.EUR_TO_TRY_RATE) || 36.20;
        this.rates.lastUpdate = new Date();
      }
      
      return false;
    }
  }

  /**
   * Kur bilgisini al (cache'den veya API'den)
   */
  async getRate(currency) {
    currency = currency.toUpperCase();
    
    if (!['USD', 'EUR'].includes(currency)) {
      return 1; // TRY için 1 döndür
    }

    // Cache kontrolü
    const now = Date.now();
    const lastUpdate = this.rates.lastUpdate ? this.rates.lastUpdate.getTime() : 0;
    
    if (!this.rates[currency] || (now - lastUpdate) > this.cacheTimeout) {
      await this.fetchRatesFromTCMB();
    }

    return this.rates[currency] || 1;
  }

  /**
   * Fiyatı TL'ye çevir
   */
  async convertToTRY(amount, currency) {
    if (!currency || currency.toUpperCase() === 'TRY' || currency === '') {
      return amount;
    }

    const rate = await this.getRate(currency);
    return amount * rate;
  }

  /**
   * Tüm kurları al (debug için)
   */
  async getAllRates() {
    if (!this.rates.lastUpdate) {
      await this.fetchRatesFromTCMB();
    }

    return {
      USD: this.rates.USD,
      EUR: this.rates.EUR,
      lastUpdate: this.rates.lastUpdate
    };
  }

  /**
   * Kurları manuel güncelle (cron job için)
   */
  async updateRates() {
    logger.info('Updating currency rates...');
    return await this.fetchRatesFromTCMB();
  }
}

module.exports = new CurrencyService();