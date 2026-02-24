const axios = require('axios');

const GRAPH_API_VERSION = 'v21.0';

/**
 * Sends a text message via WhatsApp Cloud API.
 * @param {string} to - Recipient phone number (e.g. "972501234567")
 * @param {string} text - Message body
 */
async function sendTextMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.error('[WhatsApp] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN');
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  try {
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[WhatsApp] Message sent to ${to}`);
  } catch (error) {
    console.error('[WhatsApp] Failed to send message:', error.response?.data || error.message);
  }
}

module.exports = { sendTextMessage };
