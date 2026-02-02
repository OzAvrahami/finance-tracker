const xlsx = require('xlsx');
const supabase = require('../config/supabase');
const profiles = require('../config/importProfiles');

exports.previewImport = async (req, res) => {
  try {
    const { profile: profileKey } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    if (!profiles[profileKey]) return res.status(400).json({ error: 'Invalid profile selected' });

    const profile = profiles[profileKey];

    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    const rawRows = xlsx.utils.sheet_to_json(sheet, { range: profile.startRow });

    const { data: categories } = await supabase.from('categories').select('*');
    const generalCategory = categories.find(c => c.name === 'General') || categories[0];

    const processedRows = rawRows
      .filter(row => profile.isValidRow(row))
      .map((row, index) => {
        const mapping = profile.columnsMapping;
        
        const description = row[mapping.description]?.trim() || 'Unknown';
        const dateStr = row[mapping.date]; // DD/MM/YYYY format usually
        const chargeDateStr = row[mapping.charge_date];
        const amount = typeof row[mapping.amount] === 'number' ? row[mapping.amount] : parseFloat(row[mapping.amount].replace(/[₪,]/g, ''));
        
        let formattedDate = dateStr;
        if (dateStr && dateStr.includes('/')) {
            const [d, m, y] = dateStr.split('/');
            formattedDate = `20${y.length === 2 ? y : y.slice(-2)}-${m}-${d}`;
        }

        let chargeDate = chargeDateStr;
        if (chargeDateStr && chargeDateStr.includes('/')) {
          const [d, m, y] = chargeDateStr.split('/');
          chargeDate = `20${y.length === 2 ? y : y.slice(-2)}-${m}-${d}`;
        }

        let suggestedCategory = null; 
        const match = categories.find(cat => 
            cat.keywords && cat.keywords.some(k => description.toLowerCase().includes(k.toLowerCase()))
        );
        
        if (match) {
            suggestedCategory = { id: match.id, name: match.name, icon: match.icon };
        } else {
            suggestedCategory = null; 
        }

        return {
            id: index,
            transaction_date: formattedDate,
            charge_date: chargeDate,
            description: description,
            total_amount: amount,
            movement_type: 'expense',
            original_amount: mapping.originalAmount ? row[mapping.originalAmount] : null,
            currency: mapping.currency ? row[mapping.currency] : 'ILS',
            exchange_rate: mapping.exchangeRate ? row[mapping.exchangeRate] : null,
            installments_info: mapping.installments ? row[mapping.installments] : null,
            payment_method: 'credit_card',
            payment_source: mapping.source ? row[mapping.source] : 'Unknown Credit Card',
            suggested_category: suggestedCategory
        };
      });

    res.json({ 
        message: 'File processed successfully', 
        totalRows: processedRows.length,
        previewData: processedRows 
    });

  } catch (error) {
    console.error('Import Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.saveImport = async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!transactions || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to save' });
    }

    console.log('🔍 First Transaction Check:', {
        description: transactions[0].description,
        received_cat_id: transactions[0].category_id,
        type_of_cat: typeof transactions[0].category_id
    });
    
    const recordsToInsert = transactions.map(t => ({
      payment_source: t.payment_source, 
      payment_method: t.payment_method,
      transaction_date: t.transaction_date,
      charge_date: t.charge_date,
      description: t.description,
      total_amount: t.total_amount === '' ? 0 : t.total_amount,
      movement_type: t.movement_type,
      category_id: t.category_id || null,
      original_amount: t.original_amount === '' ? null : t.original_amount,
      currency: t.currency,
      exchange_rate: t.exchange_rate === '' ? null : t.exchange_rate,
      installments_info: t.installments_info,
      
      created_at: new Date()
    }));

    const { data, error } = await supabase
      .from('transactions')
      .insert(recordsToInsert);

    if (error) throw error;

    res.json({ success: true, count: recordsToInsert.length });

  } catch (error) {
    console.error('Save Error:', error);
    res.status(500).json({ error: error.message });
  }
};