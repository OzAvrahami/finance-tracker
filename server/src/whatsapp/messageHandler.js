const { parseExpenseMessage } = require('./expenseParser');
const { sendTextMessage } = require('./whatsappService');
const { findCategoryByMerchant, findMerchantMapping, saveMerchantMapping, getTopCategories } = require('./categoriesRepo');
const { createTransaction } = require('./transactionsRepo');
const { savePending, getPending, deletePending } = require('./pendingActionsRepo');

const HELP_TEXT = `*בוט הוצאות* - מעקב מהיר 💰

📝 *רישום הוצאה:*
שלח שם עסק + סכום, למשל:
• שופרסל 150
• 89.90 סופר פארם

📂 *קטגוריה:*
אם הבוט לא מזהה קטגוריה, הוא ישאל אותך לבחור מספר.

❓ *עזרה:*
שלח "עזרה" לראות הודעה זו.`;

/**
 * Main handler for incoming WhatsApp text messages.
 * @param {{ from: string, text: string, senderName: string }} parsed
 */
async function handleWhatsAppMessage(parsed) {
  const { from, text } = parsed;
  const trimmed = (text || '').trim();

  // 1) Help command
  if (trimmed === 'עזרה' || trimmed === 'help') {
    await sendTextMessage(from, HELP_TEXT);
    return;
  }

  // 2) Check if user has a pending category selection (replied with a number)
  const pendingChoice = parseInt(trimmed, 10);
  if (!isNaN(pendingChoice) && pendingChoice >= 1 && pendingChoice <= 5) {
    const pending = await getPending(from);
    if (pending) {
      await handlePendingReply(from, pending, pendingChoice);
      return;
    }
  }

  // 3) Try to parse as expense message ("merchant amount")
  const expense = parseExpenseMessage(trimmed);
  if (!expense) {
    await sendTextMessage(from, 'לא הבנתי 🤔\nשלח שם עסק + סכום, למשל:\nשופרסל 150\n\nאו שלח "עזרה" לפרטים.');
    return;
  }

  // 4) Try to find category
  const { merchant, amount } = expense;

  // 4a) Check user's personal merchant map first
  const mappedCategoryId = await findMerchantMapping(from, merchant);
  if (mappedCategoryId) {
    await recordExpense(from, merchant, amount, mappedCategoryId);
    return;
  }

  // 4b) Check keywords in categories table
  const matched = await findCategoryByMerchant(merchant);
  if (matched) {
    await saveMerchantMapping(from, merchant, matched.id);
    await recordExpense(from, merchant, amount, matched.id);
    return;
  }

  // 5) No category found → ask user to choose
  await askForCategory(from, merchant, amount);
}

/**
 * Record the expense and send confirmation.
 */
async function recordExpense(waId, merchant, amount, categoryId) {
  const tx = await createTransaction({
    category_id: categoryId,
    amount,
    description: merchant,
  });

  if (tx) {
    await sendTextMessage(waId, `נרשם ✅ ${merchant} ${amount}`);
  } else {
    await sendTextMessage(waId, 'שגיאה ברישום ההוצאה. נסה שוב.');
  }
}

/**
 * Send a numbered category menu and save pending action.
 */
async function askForCategory(waId, merchant, amount) {
  const categories = await getTopCategories(5);

  if (categories.length === 0) {
    await sendTextMessage(waId, 'לא נמצאו קטגוריות במערכת. הוסף קטגוריות דרך האפליקציה.');
    return;
  }

  const lines = categories.map((cat, i) => `${i + 1}) ${cat.name}`);
  const msg = `לא מצאתי קטגוריה ל'${merchant}'.\nבחר מספר:\n${lines.join('\n')}`;

  await savePending(waId, {
    merchant,
    amount,
    categoryOptions: categories.map(c => ({ id: c.id, name: c.name })),
  });

  await sendTextMessage(waId, msg);
}

/**
 * Handle user's numeric reply to a pending category selection.
 */
async function handlePendingReply(waId, pending, choice) {
  const { merchant, amount, categoryOptions } = pending;

  if (choice < 1 || choice > categoryOptions.length) {
    await sendTextMessage(waId, `בחר מספר בין 1 ל-${categoryOptions.length}.`);
    return;
  }

  const chosen = categoryOptions[choice - 1];

  await deletePending(waId);
  await saveMerchantMapping(waId, merchant, chosen.id);
  await recordExpense(waId, merchant, amount, chosen.id);
}

module.exports = { handleWhatsAppMessage };
