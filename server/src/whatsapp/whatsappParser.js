/**
 * Parses an incoming Meta WhatsApp Cloud API webhook payload.
 * Returns null if no valid text message is found.
 *
 * Example incoming payload:
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "id": "BUSINESS_ACCOUNT_ID",
 *     "changes": [{
 *       "value": {
 *         "messaging_product": "whatsapp",
 *         "metadata": { "display_phone_number": "972501234567", "phone_number_id": "123456" },
 *         "contacts": [{ "profile": { "name": "Oz" }, "wa_id": "972501234567" }],
 *         "messages": [{
 *           "from": "972501234567",
 *           "id": "wamid.HBgL...",
 *           "timestamp": "1718900000",
 *           "type": "text",
 *           "text": { "body": "שלום!" }
 *         }]
 *       },
 *       "field": "messages"
 *     }]
 *   }]
 * }
 *
 * Returns: { from: "972501234567", messageId: "wamid.HBgL...", text: "שלום!", senderName: "Oz" }
 */
function parseIncomingMessage(body) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return null;

    const message = value.messages[0];
    if (message.type !== 'text') return null;

    const contact = value.contacts?.[0];

    return {
      from: message.from,
      messageId: message.id,
      text: message.text?.body || '',
      senderName: contact?.profile?.name || '',
    };
  } catch {
    return null;
  }
}

module.exports = { parseIncomingMessage };
