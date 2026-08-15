const createTransactionWithLoanPayment = async (supabase, transaction, loanPayment) => {
  const { data, error } = await supabase.rpc('create_transaction_with_manual_loan_payment', {
    p_transaction: transaction,
    p_loan_payment: loanPayment,
  });

  if (error) throw error;
  return data;
};

const updateTransactionWithLoanPayment = async (
  supabase,
  transactionId,
  transaction,
  loanPayment,
) => {
  const { data, error } = await supabase.rpc('update_transaction_with_manual_loan_payment', {
    p_transaction_id: transactionId,
    p_transaction: transaction,
    p_loan_payment: loanPayment,
  });

  if (error) throw error;
  return data;
};

const deleteTransactionWithLoanPayment = async (supabase, transactionId) => {
  const { data, error } = await supabase.rpc('delete_transaction_with_loan_payment', {
    p_transaction_id: transactionId,
  });

  if (error) throw error;
  return data;
};

module.exports = {
  createTransactionWithLoanPayment,
  updateTransactionWithLoanPayment,
  deleteTransactionWithLoanPayment,
};
