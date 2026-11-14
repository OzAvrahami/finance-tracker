'use strict';
const express = require('express');
const { createProductionAccess } = require('./productionAccess');
const { createWorkflowRouter } = require('./workflowRouter');
const { createAdministrationRouter } = require('./administrationRouter');

function createProductionRouter({ supabase, environment = process.env }) {
  const productionAccess = createProductionAccess(environment);
  const options = { supabase, environment, productionAccess };
  const router = express.Router();
  // Dispatch only Shopping paths. Never intercept unrelated settings/finance.
  router.use((req, res, next) => {
    if (!/^\/(shopping(?:\/|$)|settings\/shopping(?:\/|$))/i.test(req.path)) return next('router');
    // index.js parses JSON before dispatch. Preserve the narrower route limit.
    const limit = /\/receipt\/(draft|confirm)\/?$/i.test(req.path) ? 2 * 1024 * 1024 : 64 * 1024;
    if (req.transactionBodyBytes > limit) return res.status(413).json({ code: 'shopping_input_invalid', error: 'shopping_input_invalid' });
    return productionAccess.middleware(req, res, next);
  });
  router.get('/shopping/capabilities', (req, res) => res.json({ contract: 'hierarchy-v1', administration: productionAccess.adminIds.includes(req.user?.id) }));
  const admin = createAdministrationRouter(options);
  router.use((req, res, next) => req.path === '/shopping/category-tree' ? admin(req, res, next) : next());
  router.use('/shopping', createWorkflowRouter(options));
  router.use('/settings/shopping', createWorkflowRouter({ ...options, settingsOnly: true }));
  router.use(admin);
  router.use((req, res) => res.status(404).json({ code: 'shopping_route_not_found' }));
  return router;
}
module.exports = { createProductionRouter };
