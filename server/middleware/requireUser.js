'use strict';

// Existing Finance Tracker bearer/getUser authentication, with an injectable
// Supabase client so isolated integration never loads hosted credentials.
function createRequireAuth(supabase, { codes = false } = {}) {
  const failure = message => ({ error: message, ...(codes ? { code: 'shopping_unauthenticated' } : {}) });
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json(failure('Missing or invalid authorization header'));
    try {
      const { data: { user }, error } = await supabase.auth.getUser(header.split(' ')[1]);
      if (error || !user) return res.status(401).json(failure('Invalid or expired token'));
      req.user = user;
      next();
    } catch {
      res.status(401).json(failure('Authentication failed'));
    }
  };
}
module.exports = { createRequireAuth };
