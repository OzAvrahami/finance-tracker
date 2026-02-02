const express = require('express');
const cors = require('cors');
const transactionRoutes = require('./routes/transactionRoutes');
const legoRoutes = require('./routes/legoRoutes');
const importRoutes = require('./routes/importRoutes');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/import', importRoutes);

// שימוש בנתיבים שהגדרנו
app.use('/api/transactions', transactionRoutes);
app.use('/api/lego', legoRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Architecture is solid on port ${PORT}`));