const { createClient } = require('@supabase/supabase-js');
const { createRequireAuth } = require('./requireUser');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const requireAuth = createRequireAuth(supabase);

module.exports = { requireAuth };
