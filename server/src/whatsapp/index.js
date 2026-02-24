const whatsappRoutes = require('./whatsappRoutes');

/**
 * Registers WhatsApp webhook routes on the Express app.
 * These routes sit OUTSIDE /api so they bypass auth and rate limiting.
 */
function setupWhatsApp(app) {
  app.use('/webhook/whatsapp', whatsappRoutes);
  console.log('[WhatsApp] Webhook registered at /webhook/whatsapp');
}

module.exports = setupWhatsApp;
