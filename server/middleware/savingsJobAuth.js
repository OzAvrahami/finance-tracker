const { timingSafeEqual } = require('node:crypto');

const requireSavingsJobSecret = (req, res, next) => {
  const configured = process.env.SAVINGS_JOB_SECRET;
  if (process.env.SAVINGS_JOB_ENABLED !== 'true' || !configured) {
    return res.status(503).json({ error: 'Savings job is disabled or not configured' });
  }
  const authorization = req.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const left = Buffer.from(supplied), right = Buffer.from(configured);
  if (!left.length || left.length !== right.length || !timingSafeEqual(left, right)) {
    return res.status(401).json({ error: 'Invalid job authorization' });
  }
  return next();
};
module.exports = { requireSavingsJobSecret };
