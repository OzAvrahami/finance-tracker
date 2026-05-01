const supabase = require('../config/supabase');

const ALLOWED_FIELDS = ['title', 'notes', 'status', 'priority', 'category', 'due_date', 'source', 'transaction_id', 'loan_id'];

exports.getTasks = async (req, res) => {
  try {
    const { status, priority, category, search, overdue } = req.query;

    let query = supabase
      .from('tasks')
      .select('*, transactions(id, description), loans(id, name)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (category) query = query.eq('category', category);
    if (search) query = query.ilike('title', `%${search}%`);
    if (overdue === 'true') {
      const today = new Date().toISOString().split('T')[0];
      query = query
        .not('due_date', 'is', null)
        .lt('due_date', today)
        .neq('status', 'done')
        .neq('status', 'cancelled');
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('getTasks Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'כותרת המשימה נדרשת' });
    }

    const taskData = {};
    ALLOWED_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) taskData[f] = req.body[f];
    });
    taskData.title = String(title).trim();
    if (!taskData.due_date) taskData.due_date = null;
    if (!taskData.transaction_id) taskData.transaction_id = null;
    if (!taskData.loan_id) taskData.loan_id = null;

    const { data, error } = await supabase
      .from('tasks')
      .insert([taskData])
      .select('*, transactions(id, description), loans(id, name)');
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('createTask Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('tasks')
      .select('*, transactions(id, description), loans(id, name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Task not found' });
    res.json(data);
  } catch (error) {
    console.error('getTaskById Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    ALLOWED_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (updates.status === 'done') {
      updates.completed_at = new Date().toISOString();
    } else if (updates.status && updates.status !== 'done') {
      updates.completed_at = null;
    }

    if (updates.due_date === '') updates.due_date = null;
    if (updates.transaction_id === '' || updates.transaction_id === 0) updates.transaction_id = null;
    if (updates.loan_id === '' || updates.loan_id === 0) updates.loan_id = null;

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select('*, transactions(id, description), loans(id, name)');
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Task not found' });
    res.json(data[0]);
  } catch (error) {
    console.error('updateTask Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('deleteTask Error:', error);
    res.status(500).json({ error: error.message });
  }
};
