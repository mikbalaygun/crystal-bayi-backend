const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// POST /api/contact/info - Send contact form
router.post('/info', authenticateToken, catchAsync(async (req, res) => {
  const { subject, title, description } = req.body;
  const user = req.user;

  if (!subject || !title || !description) {
    throw new AppError('Subject, title and description are required', 400);
  }

  logger.request(req, `Contact form submission from user: ${user.hesap}`);

  try {
    let transporter = nodemailer.createTransporter({
      host: "smtp.office365.com",
      port: 587,
      tls: { ciphers: 'SSLv3' },
      secure: false,
      auth: {
        user: "info@kristalaksesuar.com",
        pass: "05343009550Ka",
      },
    });

    let info = await transporter.sendMail({
      from: "info@kristalaksesuar.com",
      to: ["muhasebe@kristalaksesuar.com"],
      subject: "Müşteri Paneli - " + subject,
      html: `
        <!DOCTYPE html>
        <html lang="tr">
          <head>
            <meta charset="UTF-8" />
            <title>Müşteri Talebi</title>
          </head>
          <body>
            <h3>${user.company}</h3>
            <h3>${subject} - ${title}</h3>
            <div style="max-width: 600px; padding: 20px;">
              <p><strong>Gönderen:</strong> ${user.username} (${user.company})</p>
              <p><strong>E-posta:</strong> ${user.email}</p>
              <p><strong>Telefon:</strong> ${user.phone}</p>
              <p><strong>Konu:</strong> ${subject}</p>
              <p><strong>Başlık:</strong> ${title}</p>
              <hr>
              <p><strong>Açıklama:</strong></p>
              <p>${description}</p>
            </div>
          </body>
        </html>
      `,
    });

    logger.info('Contact form email sent successfully', {
      userHesap: user.hesap,
      subject,
      messageId: info.messageId,
      requestId: req.id
    });

    res.json({
      success: true,
      message: 'Talebiniz başarıyla iletildi.'
    });

  } catch (error) {
    logger.error('Failed to send contact form email:', {
      userHesap: user.hesap,
      error: error.message,
      requestId: req.id
    });

    throw new AppError('E-posta gönderilirken hata oluştu', 500);
  }
}));

module.exports = router;