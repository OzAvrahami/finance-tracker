const crypto = require('crypto');

function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
  }

  const token = authHeader.slice(7);
  const apiKey = process.env.EXTERNAL_API_KEY || '';

  // HMAC-normalize both sides so timingSafeEqual works regardless of input length
  const tokenHash = crypto.createHmac('sha256', 'v1-key-compare').update(token).digest();
  const keyHash = crypto.createHmac('sha256', 'v1-key-compare').update(apiKey).digest();

  if (!crypto.timingSafeEqual(tokenHash, keyHash)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
  }

  next();
}

module.exports = { apiKeyAuth };
