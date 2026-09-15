const { randomUUID } = require('node:crypto');
const supabase = require('../config/supabase');
const { getJerusalemDate } = require('./dueLoanPaymentService');

// Discovery is read-only. PostgreSQL revalidates the captured plan under the
// common Savings locks and owns the date, cash amount and permanent month claim.
const processDueSavingsDeposits = async ({ supabaseClient = supabase } = {}) => {
  const today = getJerusalemDate();
  const candidates = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseClient.from('savings_account_summary')
      .select('account_id::text,next_due_date,plan_revision::text')
      .eq('status', 'active').eq('auto_deposit_enabled', true).lte('next_due_date', today)
      .order('account_id').range(offset, offset + 499);
    if (error) throw error;
    candidates.push(...data);
    if (data.length < 500) break;
  }
  // Capture the complete candidate set before advancing any dates: one oldest
  // occurrence per account per invocation, including after a long outage.
  const summary = { today, processed: 0, alreadyClaimed: 0, skipped: 0, failed: 0, results: [] };
  for (const account of candidates) {
    const requestKey = randomUUID();
    const args = { p_request_key: requestKey, p_command: { action: 'due', account_id: account.account_id,
      occurrence_month: `${account.next_due_date.slice(0, 7)}-01`, expected_due_date: account.next_due_date,
      plan_revision: account.plan_revision } };
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await supabaseClient.rpc('post_savings_event', args);
      if (!response.error || !['40001', '40P01'].includes(response.error.code)
          || response.error.details?.startsWith('SAVINGS_')) break;
    }
    const result = { accountId: account.account_id, dueDate: account.next_due_date };
    if (response.error) {
      const stale = response.error.details === 'SAVINGS_PREVIEW_STALE';
      summary[stale ? 'skipped' : 'failed']++;
      Object.assign(result, { status: stale ? 'skipped' : 'failed', code: response.error.details?.match(/^SAVINGS_[A-Z_]+$/)?.[0] || 'SAVINGS_JOB_FAILED' });
    } else if (response.data.status === 'already_claimed' || response.data.replayed) {
      summary.alreadyClaimed++; result.status = 'already_claimed';
    } else {
      summary.processed++; Object.assign(result, { status: 'processed', transactionId: response.data.transaction_id });
    }
    summary.results.push(result);
  }
  return summary;
};
module.exports = { processDueSavingsDeposits };
