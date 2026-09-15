const { processDueSavingsDeposits } = require('../services/dueSavingsDepositService');
const createProcessDueSavingsHandler = (processor = processDueSavingsDeposits) => async (req, res) => {
  try {
    const result = await processor({});
    return res.status(result.failed ? 500 : 200).json(result);
  } catch {
    // Do not serialize upstream connection, authentication or database errors.
    return res.status(500).json({ error: 'Savings job failed before processing' });
  }
};
module.exports = { createProcessDueSavingsHandler, processDueSavings: createProcessDueSavingsHandler() };
