const supabase = require('../config/supabase');

exports.createCategory = async (req, res) => {
  try {
    const { name, type } = req.body;

       if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const { data, error } = await supabase
      .from('categories')
      .insert([
        { 
          name: name, 
          type: type || 'expense',
          keywords: [],
          icon: '🏷️' 
        }
      ])
      .select() 
      .single();

    if (error) throw error;

    res.status(201).json(data);

  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: error.message });
  }
};