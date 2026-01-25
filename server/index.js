// server/index.js
const express = require('express');
const cors = require('cors');
const transactionRoutes = require('./routes/transactionRoutes');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// שימוש בנתיבים שהגדרנו
app.use('/api/transactions', transactionRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Architecture is solid on port ${PORT}`));