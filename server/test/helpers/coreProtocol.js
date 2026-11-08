'use strict';
// Transport model for existing controller/HTTP contract tests. Their scripted
// outcomes are NOT a policy oracle. Real decisions, SQL effects and privileges
// are tested in ingestionCorePostgres.local.test.js. Never import from runtime.
const { normalize } = require('../../services/ingestion/normalization');
function withCoreProtocol(db) {
  if (db.coreProtocol) return db;
  const calls = [];
  const adapted = Object.assign(Object.create(db), { coreProtocol: true, coreCalls: calls, rpc: (name, args) => {
    if (!name.startsWith('ingestion_core_')) return db.rpc(name, args);
    calls.push({ name, args });
    const s = args.p_scope, input = s.request || s.row || s.observation || {}, sourceId = String(s.source_id || 1);
    if (name === 'ingestion_core_snapshot') {
      const payment = String(input.payment_source_id || 1), source = { id: sourceId, is_active: true, revision: '1',
        source_kind: s.channel === 'external' ? 'external_api' : s.channel === 'manual' ? 'manual' : s.channel === 'csv' ? 'file_import' : 'apple_pay',
        instance_key: `unified:${s.channel === 'external' ? 'v1' : s.channel}`,
        configuration: { payment_source_ids: [payment], card_mappings: input.payment_evidence?.card_reference
          ? [{ card_reference: input.payment_evidence.card_reference, payment_source_id: payment }] : [] } };
      return { data: { token: 'synthetic-token', facts: { scope: s, hash: 'synthetic-hash', source_id: sourceId,
        sources: [source], payments: [{ id: payment, name: input.payment_source_name || 'Synthetic', method: 'credit_card', is_active: true }],
        categories: input.category_id != null ? [{ id: String(input.category_id), name: 'Synthetic', type: input.movement_type || input.type || 'expense', is_active: true, savings_role: null }] : [],
        observations: [], transactions: [], installments: [], events: [], registrations: [], general_group: [],
        auth: { credential_status: 'active', device_status: 'active', source_matches: true,
          binding: { source_id: sourceId, payment_source_id: payment, status: 'active' } },
      } } };
    }
    if (name !== 'ingestion_core_commit') throw new Error(`Unexpected core RPC: ${name}`);
    // Existing scripted callbacks describe a logical ingestion command. Adapt
    // their argument vocabulary here; no obsolete RPC is executed by runtime.
    if (s.channel === 'external') return db.rpc('ingest_external_transaction', { p_request: s.request, p_dry_run: s.dry_run });
    if (['manual', 'csv'].includes(s.channel)) return db.rpc('ingest_owned_transaction', { p_channel: s.channel, p_key: s.key, p_row: s.row, p_evidence: s.evidence, p_domain: s.domain });
    if (s.channel === 'flowlink') return db.rpc('ingest_flowlink_observation', { p_credential_sha256: s.credential, p_request: s.request });
    if (s.channel === 'observation') return db.rpc('ingest_observation', { p_source_id: s.source_id,
      p_observation: { ...s.observation, accounting_amount: normalize(s.observation).input.accounting_amount } });
    const commandName = s.command_kind === 'general' ? 'resolve_general_receipt' : s.command_kind === 'cancel' ? 'cancel_ingested_transaction'
      : s.command_kind === 'amend' ? 'amend_observation' : s.review ? 'review_reconciliation' : 'resolve_observation';
    return db.rpc(commandName, { p_request_key: s.request_key, p_command: s.command });
  } });
  return adapted;
}
module.exports = { withCoreProtocol };
