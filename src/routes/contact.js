const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();
const soap = require('soap'); // SOAP client

const { AppError, catchAsync } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// SOAP service helper
const getCustomerRepresentative = async (hesapKodu) => {
  try {
    const wsdlUrl = process.env.SOAP_WSDL_URL; // SOAP servis URL'inizi ekleyin
    const client = await soap.createClientAsync(wsdlUrl, {
      timeout: 5000, // 5 saniye timeout
    });
    
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SOAP request timeout'));
      }, 5000);
      
      client['sl-personmail'](
        { hesapKodu }, // Parametre
        (err, result) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve(result);
        }
      );
    });
    
    // ERP'den sadece vmail geliyor
    const email = result?.vmail || null;
    
    return {
      name: result?.temsilciAdi || null, // Eğer isim field'ı varsa
      email: email && email.trim() !== '' ? email : null // Boş string kontrolü
    };
  } catch (error) {
    logger.error('Failed to get customer representative:', {
      hesapKodu,
      error: error.message
    });
    return null;
  }
};

// POST /api/contact/info - Send contact form
router.post('/info', authenticateToken, catchAsync(async (req, res) => {
  const { subject, title, description } = req.body;
  const user = req.user;

  if (!subject || !title || !description) {
    throw new AppError('Subject, title and description are required', 400);
  }

  logger.request(req, `Contact form submission from user: ${user.hesap}`);

  try {
    // Müşteri temsilcisini al
    let customerRep = null;
    let recipientEmail = "info@kristalaksesuar.com"; // Default fallback email
    let repInfo = "";

    if (user.hesap) {
      customerRep = await getCustomerRepresentative(user.hesap);
      
      if (customerRep && customerRep.email) {
        recipientEmail = customerRep.email;
        repInfo = customerRep.name 
          ? `<p><strong>Müşteri Temsilcisi:</strong> ${customerRep.name}</p>`
          : `<p><strong>Müşteri Temsilcisi Email:</strong> ${customerRep.email}</p>`;
        
        logger.info('Customer representative found:', {
          hesapKodu: user.hesap,
          repEmail: customerRep.email,
          repName: customerRep.name || 'Not specified'
        });
      } else {
        logger.warn('Customer representative not found, using default email:', {
          hesapKodu: user.hesap,
          fallbackEmail: recipientEmail
        });
      }
    }

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

    // Email gönderimi
    let info = await transporter.sendMail({
      from: "info@kristalaksesuar.com",
      to: [recipientEmail],
      // CC olarak info@'yu da ekle (temsilci varsa)
      cc: customerRep?.email && customerRep.email !== "info@kristalaksesuar.com" 
        ? ["info@kristalaksesuar.com"] 
        : [],
      subject: `Müşteri Paneli - ${subject} - ${user.company}`,
      html: `
        <!DOCTYPE html>
        <html lang="tr">
          <head>
            <meta charset="UTF-8" />
            <title>Müşteri Talebi</title>
          </head>
          <body>
            <div style="max-width: 600px; padding: 20px; font-family: Arial, sans-serif;">
              <h2 style="color: #333; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                Müşteri Panel Talebi
              </h2>
              
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #2c3e50;">${subject} - ${title}</h3>
              </div>

              <div style="margin: 20px 0;">
                <h4 style="color: #34495e; margin-bottom: 15px;">Firma Bilgileri:</h4>
                <p><strong>Firma:</strong> ${user.company}</p>
                <p><strong>Hesap Kodu:</strong> ${user.hesap}</p>
                <p><strong>Kullanıcı:</strong> ${user.username}</p>
                <p><strong>E-posta:</strong> ${user.email}</p>
                <p><strong>Telefon:</strong> ${user.phone}</p>
                ${repInfo}
              </div>

              <div style="margin: 20px 0;">
                <h4 style="color: #34495e; margin-bottom: 15px;">Talep Detayları:</h4>
                <p><strong>Konu:</strong> ${subject}</p>
                <p><strong>Başlık:</strong> ${title}</p>
              </div>

              <div style="background-color: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px;">
                <h4 style="color: #34495e; margin-top: 0;">Açıklama:</h4>
                <p style="line-height: 1.6;">${description.replace(/\n/g, '<br>')}</p>
              </div>

              <div style="margin-top: 30px; font-size: 12px; color: #7f8c8d; border-top: 1px solid #ecf0f1; padding-top: 15px;">
                <p>Bu e-posta müşteri paneli üzerinden otomatik olarak gönderilmiştir.</p>
                <p>Gönderim Tarihi: ${new Date().toLocaleString('tr-TR')}</p>
                <p>Alıcı: ${recipientEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    logger.info('Contact form email sent successfully:', {
      userHesap: user.hesap,
      subject,
      recipientEmail,
      hasCustomerRep: !!customerRep?.email,
      messageId: info.messageId,
      requestId: req.id
    });

    // Response message'ı duruma göre özelleştir
    let responseMessage = 'Talebiniz başarıyla iletildi.';
    if (customerRep?.email) {
      responseMessage = customerRep.name
        ? `Talebiniz müşteri temsilciniz ${customerRep.name}'e başarıyla iletildi.`
        : 'Talebiniz müşteri temsilcinize başarıyla iletildi.';
    } else {
      responseMessage = 'Talebiniz müşteri hizmetleri ekibimize başarıyla iletildi.';
    }

    res.json({
      success: true,
      message: responseMessage,
      customerRepresentative: customerRep?.name || null,
      sentTo: recipientEmail
    });

  } catch (error) {
    logger.error('Failed to send contact form email:', {
      userHesap: user.hesap,
      error: error.message,
      stack: error.stack,
      requestId: req.id
    });

    throw new AppError('E-posta gönderilirken hata oluştu', 500);
  }
}));

// GET /api/contact/representative - Get customer representative info
router.get('/representative', authenticateToken, catchAsync(async (req, res) => {
  const user = req.user;
  
  if (!user.hesap) {
    throw new AppError('Hesap kodu bulunamadı', 400);
  }

  const customerRep = await getCustomerRepresentative(user.hesap);
  
  res.json({
    success: true,
    data: {
      representative: customerRep?.name || 'Müşteri Temsilcisi',
      email: customerRep?.email || null,
      hasRepresentative: !!customerRep?.email
    }
  });
}));

// authenticateToken'ı kaldırın
router.get('/test-representative/:hesapKodu', catchAsync(async (req, res) => {
  const { hesapKodu } = req.params;
  
  try {
    const result = await getCustomerRepresentative(hesapKodu);
    
    res.json({
      success: true,
      hesapKodu,
      result,
      hasEmail: !!result?.email,
      willUseDefault: !result?.email
    });
  } catch (error) {
    res.json({
      success: false,
      hesapKodu,
      error: error.message,
      willUseDefault: true
    });
  }
}));

module.exports = router;