const supabase = require('../config/supabase');
const savings = require('../services/savingsService');
const { rpc } = require('../services/savingsTransactionService');

const handle = (action, status = 200) => async (req, res) => {
  try { res.status(status).json(await action(req)); } catch (error) {
    const statusCode = error.code === 'P0002' ? 404
      : ['22023', '22007', '22008', '22003', '23514', '23502', '23503', '23505'].includes(error.code) ? 422
        : ['40001', '40P01'].includes(error.code) ? 409 : 500;
    const message = /[\u0590-\u05ff]/.test(error.message || '') ? error.message
      : statusCode === 422 ? 'פרטי החיסכון אינם תקינים. בדקו סכומים, תאריכים, יעד ומקור תשלום פעיל.'
        : statusCode === 409 ? 'הנתונים השתנו במהלך השמירה. רעננו ונסו שוב.'
          : 'לא ניתן להשלים את הפעולה בחיסכון כעת. נסו שוב.';
    res.status(statusCode).json({ error: message, code: error.savingsCode || error.code || 'SAVINGS_REQUEST_FAILED' });
  }
};
exports.report = handle(req => savings.getReport(supabase, req.query));
exports.list = handle(() => savings.listAccounts(supabase));
exports.surplusPreview = handle(req => rpc(supabase, 'get_savings_surplus_preview', {
  p_source_month: req.body.source_month, p_category_id: savings.identifier(req.body.category_id),
  p_account_id: savings.identifier(req.body.account_id), p_amount: savings.money(req.body.amount, 'סכום העברה'),
  p_payment_source_id: savings.identifier(req.body.payment_source_id), p_cash_date: savings.date(req.body.cash_date),
}));
exports.applySurplus = handle(req => rpc(supabase, 'apply_savings_surplus', { p_request_key: req.body.request_key, p_preview_fingerprint: req.body.preview_fingerprint, p_command: req.body.command }), 201);
exports.reverseSurplus = handle(req => rpc(supabase, 'reverse_savings_surplus', { p_request_key: req.body.request_key, p_operation_id: savings.identifier(req.params.id), p_preview_fingerprint: req.body.preview_fingerprint, p_reason: req.body.reason }));
exports.get = handle((req) => savings.getAccount(supabase, req.params.id, req.query));
exports.create = handle((req) => savings.createAccount(supabase, req.body), 201);
exports.update = handle((req) => savings.updateAccount(supabase, req.params.id, req.body));
exports.postEvent = handle(req => rpc(supabase, 'post_savings_event', { p_request_key: req.body.request_key, p_command: req.body.command }), 201);
exports.correctEvent = handle(req => rpc(supabase, 'correct_savings_event', { p_request_key: req.body.request_key, p_entry_id: req.params.id, p_expected_revision: req.body.expected_revision, p_replacement: req.body.replacement, p_reason: req.body.reason }));
exports.cancelEvent = handle(req => rpc(supabase, 'cancel_savings_event', { p_request_key: req.body.request_key, p_entry_id: req.params.id, p_expected_revision: req.body.expected_revision, p_cash_action: req.body.cash_action, p_reason: req.body.reason }));
exports.voidDetached = handle(req => rpc(supabase, 'void_detached_savings_transaction', { p_request_key: req.body.request_key, p_transaction_id: req.params.id, p_expected_transaction_fingerprint: req.body.expected_transaction_fingerprint, p_reason: req.body.reason }));
