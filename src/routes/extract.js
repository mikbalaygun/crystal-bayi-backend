// routes/extract.js
const express = require('express');
const router = express.Router();
const moment = require('moment');

const soapService = require('../services/soapService');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// GET /api/extract - list
router.get('/', authenticateToken, catchAsync(async (req, res) => {
  const userHesap = req.user.hesap;
  const { start, end } = req.query;

  logger.request(req, `Fetching extract for user: ${userHesap}`);

  const dateFilters = {
    startDate: start || moment().startOf('year').format('DD-MM-YYYY'),
    endDate: end || moment().format('DD-MM-YYYY')
  };

  const extractData = await soapService.getExtract(userHesap, dateFilters);

  logger.info('Extract fetched successfully', {
    userHesap,
    recordCount: extractData.length,
    dateFilters,
    requestId: req.id
  });

  return res.json({ success: true, data: extractData });
}));

// GET /api/extract/:id - detail
router.get('/:id', authenticateToken, catchAsync(async (req, res) => {
  const { id } = req.params;
  const userHesap = req.user.hesap;

  if (!id) throw new AppError('Extract ID is required', 400);

  logger.request(req, `Fetching extract detail: ${id}, user: ${userHesap}`);

  const detailRows = await soapService.getExtractDetail(id); // vfkn=id

  logger.info('Extract detail fetched', {
    userHesap,
    extractId: id,
    recordCount: detailRows.length,
    requestId: req.id
  });

  return res.json({ success: true, data: detailRows });
}));

module.exports = router;
