const { createHash, randomUUID } = require('node:crypto');
const { submitOwned } = require('../services/unifiedTransactionIngestion');
const xlsx = require('xlsx');
const supabase = require('../config/supabase');
const profiles = require('../config/importProfiles');
const { rejectUnsupported } = require('../services/savingsTransactionService');
const { importDate } = require('../utils/importDate');

exports.previewImport = async (req, res) => {
  try {
    const { profile: profileKey } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    if (!profiles[profileKey]) return res.status(400).json({ error: 'Invalid profile selected' });

    const profile = profiles[profileKey];

    // Preserve CSV text, especially ambiguous DD/MM dates. Excel auto-inference
    // can reinterpret them as MM/DD serials before profile normalization.
    // Typed XLSX cells remain typed; raw applies to plain-text parsing only.
    const workbook = xlsx.read(file.buffer, { type: 'buffer', raw: true });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);

    const rawRows = xlsx.utils.sheet_to_json(sheet, { range: profile.startRow });

    const { data: categories } = await supabase.from('categories').select('*');
    const generalCategory = categories.find(c => c.name === 'General') || categories[0];

    const documentKey = createHash('sha256').update(profileKey).update(file.buffer).digest('hex');
    const processedRows = rawRows
      .filter(row => profile.isValidRow(row))
      .map((row, index) => {
        const mapping = profile.columnsMapping;
        
        const description = row[mapping.description]?.trim() || 'Unknown';
        const dateStr = row[mapping.date]; // DD/MM/YYYY format usually
        const chargeDateStr = row[mapping.charge_date];
        const amount = typeof row[mapping.amount] === 'number' ? row[mapping.amount] : parseFloat(row[mapping.amount].replace(/[₪,]/g, ''));
        
        const formattedDate = importDate(dateStr, { date1904 });
        const chargeDate = importDate(chargeDateStr, { date1904, optional: true, field: 'charge_date' });

        let suggestedCategory = null; 
        const match = categories.find(cat => !cat.savings_role &&
            cat.keywords && cat.keywords.some(k => description.toLowerCase().includes(k.toLowerCase()))
        );
        
        if (match) {
            suggestedCategory = { id: match.id, name: match.name, icon: match.icon };
        } else {
            suggestedCategory = null; 
        }

        return {
            id: `csv:${documentKey}:${index}`,
            transaction_date: formattedDate,
            charge_date: chargeDate,
            description: description,
            total_amount: amount,
            movement_type: 'expense',
            original_amount: mapping.originalAmount ? row[mapping.originalAmount] : null,
            currency: mapping.currency ? row[mapping.currency] : 'ILS',
            exchange_rate: mapping.exchangeRate ? row[mapping.exchangeRate] : null,
            installments_info: mapping.installments ? row[mapping.installments] : null,
            suggested_category: suggestedCategory,
            notes: null
        };
      });

    res.json({ 
        message: 'File processed successfully', 
        totalRows: processedRows.length,
        previewData: processedRows 
    });

  } catch (error) {
    console.error('Import Error:', error);
    res.status(error.status === 400 ? 400 : 500).json({ error: error.message });
  }
};

exports.saveImport = async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!transactions || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to save' });
    }

    await rejectUnsupported(supabase, req.body, transactions.map(t => t.category_id));
    for (const row of transactions) await rejectUnsupported(supabase, row);



    const paymentSourceId = req.body.payment_source_id || null;

    let recordsToInsert = transactions.map(t => ({
      payment_source_id: paymentSourceId,
      transaction_date: (t.transaction_date === '' || !t.transaction_date) ? null : t.transaction_date,
      charge_date: (t.charge_date && t.charge_date !== '') ? t.charge_date : t.transaction_date,
      description: t.description,
      total_amount: String(t.total_amount),
      movement_type: t.movement_type,
      category_id: t.category_id || null,
      original_amount: t.original_amount == null || t.original_amount === '' ? null : String(t.original_amount),
      currency: t.currency,
      exchange_rate: t.exchange_rate === '' ? null : t.exchange_rate,
      installments_info: t.installments_info,
      notes: t.notes,

      ...(typeof t.installments_info === 'string' && /^\d{1,3}\/\d{1,3}$/.test(t.installments_info) ? {
        installment_number: Number(t.installments_info.split('/')[0]),
        installment_count: Number(t.installments_info.split('/')[1]),
      } : {}),
    }));

    const accepted = [], outcomes = [];
    let interrupted = false;
    for (const [index, row] of recordsToInsert.entries()) {
      if (interrupted) { outcomes.push({ index, status: 'not_attempted', reason: 'batch_interrupted' }); continue; }
      const suppliedKey = transactions[index].id;
      const key = typeof suppliedKey === 'string' && /^csv:[a-f0-9]{64}:\d+$/.test(suppliedKey)
        ? suppliedKey : `csv:${randomUUID()}:${index}`;
      try {
        const result = await submitOwned(supabase, 'csv', row, { key, evidence: row });
        const saved = result.transaction_id && result.outcome !== 'conflict' && result.disposition !== 'cancelled';
        outcomes.push({ index, status: saved ? 'saved' : 'review_required', reason: result.reason_code });
        if (saved && !result.replayed) accepted.push(row);
      } catch (error) {
        interrupted = error.code === 'INGESTION_UNCERTAIN';
        outcomes.push({ index, status: interrupted ? 'uncertain' : 'failed', reason: error.code || 'invalid_import_row' });
      }
    }
    recordsToInsert = accepted;

    const newKeyword = recordsToInsert
      .filter(t => t.category_id)
      .map(t => {
        let cleanName = t.description
          .toString()
          .replace(/[0-9]/g, '') 
          .replace(/[^\w\s\u0590-\u05ff]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

          if (cleanName.length < 2) return null;
          
          return { keyword: cleanName, target_category_id: t.category_id };
      })
      .filter(item => item !== null);

    if (newKeyword.length > 0) {
        const { data: allCategories } = await supabase.from('categories').select('*');
        
        let updatesMap = {}; 

        const getKeywordsForCat = (catId) => {
            if (updatesMap[catId]) return updatesMap[catId];
            const cat = allCategories.find(c => c.id === catId);
            return cat ? (cat.keywords || []) : [];
        };

        newKeyword.forEach(({ keyword, target_category_id }) => {            
            allCategories.forEach(cat => {
                if (cat.id !== target_category_id) {
                    let currentWords = getKeywordsForCat(cat.id);
                    if (currentWords.includes(keyword)) {
                        updatesMap[cat.id] = currentWords.filter(w => w !== keyword);
                    }
                }
            });

            let targetWords = getKeywordsForCat(target_category_id);
            if (!targetWords.includes(keyword)) {
                updatesMap[target_category_id] = [...targetWords, keyword];
            }
        });

        for (const [catId, updatedKeywords] of Object.entries(updatesMap)) {
            await supabase
                .from('categories')
                .update({ keywords: updatedKeywords })
                .eq('id', parseInt(catId));
        }
    }

    res.json({ success: outcomes.every(o => o.status === 'saved'), count: outcomes.filter(o => o.status === 'saved').length,
      review_required: outcomes.filter(o => o.status === 'review_required').length,
      errors: outcomes.filter(o => o.status !== 'saved') });

  } catch (error) {
    console.error('Save Error:', error);
    res.status(500).json({ error: error.message });
  }
};
