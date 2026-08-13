const { processDueLoanPayments } = require('../services/dueLoanPaymentService');

const createProcessDueLoansHandler = (processor = processDueLoanPayments) => async (req, res) => {
  try {
    const summary = await processor({});
    return res.status(summary.failed > 0 ? 500 : 200).json(summary);
  } catch (error) {
    console.error('Due loan job failed before per-loan processing', {
      message: error.message,
    });
    return res.status(500).json({ error: 'Due loan job failed' });
  }
};

module.exports = {
  createProcessDueLoansHandler,
  processDueLoans: createProcessDueLoansHandler(),
};
