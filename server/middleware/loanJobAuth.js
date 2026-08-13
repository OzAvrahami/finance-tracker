const crypto = require('crypto');

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const requireLoanJobSecret = (req, res, next) => {
  const configuredSecret = process.env.LOAN_JOB_SECRET;
  if (!configuredSecret) {
    return res.status(503).json({ error: 'Loan job is not configured' });
  }

  const authorization = req.headers.authorization || '';
  const suppliedSecret = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!suppliedSecret || !safeEqual(suppliedSecret, configuredSecret)) {
    return res.status(401).json({ error: 'Invalid job authorization' });
  }

  return next();
};

module.exports = { requireLoanJobSecret };
