const { parseExpenseMessage } = require('./expenseParser');
const { sendTextMessage } = require('./whatsappService');
const {
  findCategoryByMerchant, findMerchantMapping, saveMerchantMapping,
  getCategoriesPage, searchCategories,
} = require('./categoriesRepo');
const { createTransaction } = require('./transactionsRepo');
const { savePending, getPending, deletePending } = require('./pendingActionsRepo');

const PAGE_SIZE = 4; // 4 real categories + "אחר" = 5 options in initial view
const BROWSE_PAGE_SIZE = 5;

const HELP_TEXT = `*בוט הוצאות* - מעקב מהיר 💰

📝 *רישום הוצאה:*
שלח שם עסק + סכום, למשל:
• שופרסל 150
• 89.90 סופר פארם

📂 *קטגוריה:*
אם הבוט לא מזהה קטגוריה, הוא ישאל אותך לבחור מספר.
שלח "עוד" לעוד קטגוריות, או "חיפוש מזון" לחפש.

❓ *עזרה:*
שלח "עזרה" לראות הודעה זו.`;

/**
 * Pending payload structure:
 * {
 *   merchant: string,
 *   amount: number,
 *   categoryOptions: [{ id, name }],  // currently displayed categories
 *   page: number,                     // current page (0-based)
 *   phase: "initial" | "browse",      // initial = 4+אחר, browse = up to 5
 * }
 */

/**
 * Main handler for incoming WhatsApp text messages.
 */
async function handleWhatsAppMessage(parsed) {
  const { from, text } = parsed;
  const trimmed = (text || '').trim();

  // 1) Help
  if (trimmed === 'עזרה' || trimmed === 'help') {
    await sendTextMessage(from, HELP_TEXT);
    return;
  }

  const pending = await getPending(from);

  // 2) "עוד" — next page (only when pending exists)
  if (trimmed === 'עוד' && pending) {
    await handleMore(from, pending);
    return;
  }

  // 3) "חיפוש <query>" — search categories (only when pending exists)
  const searchMatch = trimmed.match(/^חיפוש\s+(.+)$/);
  if (searchMatch && pending) {
    await handleSearch(from, pending, searchMatch[1].trim());
    return;
  }

  // 4) Numeric reply — pick from current list
  const choice = parseInt(trimmed, 10);
  if (!isNaN(choice) && choice >= 1 && pending) {
    await handleNumericReply(from, pending, choice);
    return;
  }

  // 5) New expense message
  const expense = parseExpenseMessage(trimmed);
  if (!expense) {
    // If there's a pending, the user sent something unrelated — clear it
    if (pending) await deletePending(from);
    await sendTextMessage(from, 'לא הבנתי 🤔\nשלח שם עסק + סכום, למשל:\nשופרסל 150\n\nאו שלח "עזרה" לפרטים.');
    return;
  }

  const { merchant, amount } = expense;

  // 5a) Check user's personal merchant map
  const mappedCategoryId = await findMerchantMapping(from, merchant);
  if (mappedCategoryId) {
    await recordExpense(from, merchant, amount, mappedCategoryId);
    return;
  }

  // 5b) Check keywords in categories table
  const matched = await findCategoryByMerchant(merchant);
  if (matched) {
    await saveMerchantMapping(from, merchant, matched.id);
    await recordExpense(from, merchant, amount, matched.id);
    return;
  }

  // 5c) No match — show initial category menu (4 + אחר)
  await showInitialMenu(from, merchant, amount);
}

// ─── Record ────────────────────────────────────────────

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

// ─── Initial menu (4 categories + אחר) ────────────────

async function showInitialMenu(waId, merchant, amount) {
  const { categories, hasMore } = await getCategoriesPage(0, PAGE_SIZE);

  if (categories.length === 0) {
    await sendTextMessage(waId, 'לא נמצאו קטגוריות במערכת. הוסף קטגוריות דרך האפליקציה.');
    return;
  }

  const lines = categories.map((cat, i) => `${i + 1}) ${cat.name}`);
  lines.push(`${categories.length + 1}) אחר`);

  const msg = `לא מצאתי קטגוריה ל'${merchant}'.\nבחר מספר:\n${lines.join('\n')}`;

  await savePending(waId, {
    merchant,
    amount,
    categoryOptions: categories.map(c => ({ id: c.id, name: c.name })),
    page: 0,
    phase: 'initial',
  });

  await sendTextMessage(waId, msg);
}

// ─── Numeric reply ─────────────────────────────────────

async function handleNumericReply(waId, pending, choice) {
  const { merchant, amount, categoryOptions, phase } = pending;
  const maxReal = categoryOptions.length;

  // In "initial" phase, last option is "אחר"
  if (phase === 'initial' && choice === maxReal + 1) {
    await enterBrowseMode(waId, pending);
    return;
  }

  // Valid category pick
  if (choice >= 1 && choice <= maxReal) {
    const chosen = categoryOptions[choice - 1];
    await deletePending(waId);
    await saveMerchantMapping(waId, merchant, chosen.id);
    await recordExpense(waId, merchant, amount, chosen.id);
    return;
  }

  // Out of range
  const max = phase === 'initial' ? maxReal + 1 : maxReal;
  await sendTextMessage(waId, `בחר מספר בין 1 ל-${max}.`);
}

// ─── Browse mode (user chose "אחר") ───────────────────

async function enterBrowseMode(waId, pending) {
  await savePending(waId, {
    ...pending,
    phase: 'browse',
  });

  await sendTextMessage(waId,
    `כתוב *עוד* לעוד קטגוריות\nאו *חיפוש <מילה>* כדי לחפש קטגוריה.`
  );
}

// ─── "עוד" — next page ────────────────────────────────

async function handleMore(waId, pending) {
  const nextPage = (pending.page || 0) + 1;
  const { categories, hasMore } = await getCategoriesPage(nextPage, BROWSE_PAGE_SIZE);

  if (categories.length === 0) {
    await sendTextMessage(waId, 'אין עוד קטגוריות. נסה *חיפוש <מילה>*.');
    return;
  }

  await sendCategoryList(waId, pending, categories, nextPage, hasMore);
}

// ─── "חיפוש X" — search ──────────────────────────────

async function handleSearch(waId, pending, query) {
  const results = await searchCategories(query, BROWSE_PAGE_SIZE);

  if (results.length === 0) {
    await sendTextMessage(waId, `לא נמצאו קטגוריות ל'${query}'.\nנסה מילה אחרת או שלח *עוד*.`);
    return;
  }

  await sendCategoryList(waId, pending, results, pending.page || 0, false);
}

// ─── Shared: send a numbered category list ────────────

async function sendCategoryList(waId, pending, categories, page, hasMore) {
  const lines = categories.map((cat, i) => `${i + 1}) ${cat.name}`);

  let footer = '';
  if (hasMore) footer = '\n\nשלח *עוד* לעוד קטגוריות.';
  footer += '\nאו *חיפוש <מילה>* לחיפוש.';

  const msg = `בחר קטגוריה ל'${pending.merchant}':\n${lines.join('\n')}${footer}`;

  await savePending(waId, {
    ...pending,
    categoryOptions: categories.map(c => ({ id: c.id, name: c.name })),
    page,
    phase: 'browse',
  });

  await sendTextMessage(waId, msg);
}

module.exports = { handleWhatsAppMessage };
