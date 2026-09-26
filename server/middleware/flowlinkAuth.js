const { bearer, credential, fail } = require('../config/flowlink');

// Same Supabase getUser proof as requireAuth, isolated logging/error handling.
// Does not change existing routes' authentication or treat a device token as a JWT.
function requireFlowlinkOwner(verifyUser) {
  return async (req, res, next) => {
    try {
      const token = bearer(req.headers.authorization);
      if (!token || token.startsWith('fldev1_') || token.startsWith('ftapy1_')) fail('unauthorized');
      let result;
      try { result = await verifyUser(token); } catch { fail('unauthorized'); }
      if (result.error || !result.data?.user) fail('unauthorized');
      req.user = result.data.user;
      if (!req.flowlinkOwners.has(req.user.id)) fail('owner_required');
      next();
    } catch (error) { next(error); }
  };
}
function requireFlowlinkDevice(service) {
  return async (req, res, next) => {
    try {
      const token = bearer(req.headers.authorization);
      if (!credential(token)) fail('unauthorized');
      req.flowlinkToken = token;
      req.flowlinkDevice = await service.device(token); // Fresh DB check on every request.
      next();
    } catch (error) { next(error); }
  };
}
module.exports = { requireFlowlinkOwner, requireFlowlinkDevice };
