const supabase = require('../../config/supabase');

/**
 * Save a pending action for a WhatsApp user.
 * Overwrites any existing pending for the same wa_id.
 * payload: { merchant, amount, categoryOptions: [{ id, name }] }
 */
async function savePending(waId, payload) {
  // Delete any existing pending for this user first
  await supabase
    .from('whatsapp_pending_actions')
    .delete()
    .eq('wa_id', waId);

  const { error } = await supabase
    .from('whatsapp_pending_actions')
    .insert([{
      wa_id: waId,
      payload_json: payload,
    }]);

  if (error) {
    console.error('[WhatsApp] pendingActionsRepo.savePending error:', error.message);
  }
}

/**
 * Get the pending action for a WhatsApp user.
 * Returns the payload object or null.
 */
async function getPending(waId) {
  const { data, error } = await supabase
    .from('whatsapp_pending_actions')
    .select('id, payload_json')
    .eq('wa_id', waId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[WhatsApp] pendingActionsRepo.getPending error:', error.message);
    return null;
  }

  return data ? data.payload_json : null;
}

/**
 * Delete pending action for a WhatsApp user.
 */
async function deletePending(waId) {
  const { error } = await supabase
    .from('whatsapp_pending_actions')
    .delete()
    .eq('wa_id', waId);

  if (error) {
    console.error('[WhatsApp] pendingActionsRepo.deletePending error:', error.message);
  }
}

module.exports = { savePending, getPending, deletePending };
