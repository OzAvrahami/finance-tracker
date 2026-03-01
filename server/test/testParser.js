const { resolvePaymentSourceId } = require('../src/whatsapp/paymentSourceResolver');

(async () => {
  console.log('default:', await resolvePaymentSourceId(null));
  console.log('cash:', await resolvePaymentSourceId({ kind: 'cash' }));
  console.log('card2755:', await resolvePaymentSourceId({ kind: 'card_last4', last4: '2755' }));
})();
