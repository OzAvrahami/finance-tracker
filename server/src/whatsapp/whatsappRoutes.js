const express = require('express');
const { parseIncomingMessage } = require('./whatsappParser');
const { sendTextMessage } = require('./whatsappService');

const router = express.Router();

// GET /webhook/whatsapp - Meta verification handshake
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp] Webhook verification failed');
  return res.status(403).send('Forbidden');
});

// POST /webhook/whatsapp - Incoming messages
router.post('/', async (req, res) => {
  // Always respond 200 immediately to prevent Meta retries
  res.status(200).send('OK');

  console.log('[WhatsApp] Incoming webhook:', JSON.stringify(req.body, null, 2));

  const parsed = parseIncomingMessage(req.body);
  if (!parsed) return;

  console.log(`[WhatsApp] Message from ${parsed.senderName} (${parsed.from}): ${parsed.text}`);

  // Auto-reply with echo
  const reply = `קיבלתי ✅: ${parsed.text}`;
  await sendTextMessage(parsed.from, reply);
});

module.exports = router;
