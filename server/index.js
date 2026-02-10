const express = require('express');
const cors = require('cors');
const transactionRoutes = require('./routes/transactionRoutes');
const legoRoutes = require('./routes/legoRoutes');
const importRoutes = require('./routes/importRoutes');
const categoryRoutes = require('./routes/categoriesRoutes');
const loanRoutes = require('./routes/loanRoutes');

require('dotenv').config();

const app = express();

app.use(cors({
  origin: [
    "http://localhost:5173",          // Local
    "https://YOUR-FRONTEND.vercel.app" // Prod
  ],
  credentials: true
}));

app.use(express.json());
app.get("/health", (req, res) => res.send("OK"));

app.use('/api/import', importRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/lego', legoRoutes);
app.use('/api/loans', loanRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Architecture is solid on port ${PORT}`));