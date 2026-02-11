const express = require('express');
const cors = require('cors');
const transactionRoutes = require('./routes/transactionRoutes');
const legoRoutes = require('./routes/legoRoutes');
const importRoutes = require('./routes/importRoutes');
const categoryRoutes = require('./routes/categoriesRoutes');
const loanRoutes = require('./routes/loanRoutes');
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const morgan = require("morgan");
const compression = require("compression");
const hpp = require("hpp");
const xss = require("xss-clean");


require('dotenv').config();
const requiredEnv = [
    "SUPABASE_URL",
    "SUPABASE_KEY"
];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        console.error(`Missing ENV: ${key}`);
        process.exit(1);
    }
};


const app = express();

// Render/Vercel
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// Gzip compression
app.use(compression());

// Prevent HTTP parameter pollution
app.use(hpp());

// Basic XSS sanitization 
app.use(xss());

// Logging
app.use(morgan("combined"));

// Body limits 
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Hard limit:
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 דקות
    max: 300,                 // 300 בקשות לכל IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});

// Soft limit:
const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 150,        // אחרי 150 בקשות מתחילים להאט
    delayMs: () => 200      // מוסיף 200ms לכל בקשה מעל הסף
});

app.use("/api", limiter, speedLimiter);



const allowedOrigins = [
    "http://localhost:5173",
    "https://finance-tracker-sigma-ten-19.vercel.app"
];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.get("/health", (req, res) => res.status(200).send("OK"));


app.use('/api/import', importRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/lego', legoRoutes);
app.use('/api/loans', loanRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Architecture is solid on port ${PORT}`));

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

// Central error handler
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    if (String(err.message || "").includes("Not allowed by CORS")) {
        return res.status(403).json({ error: "CORS blocked" });
    }
    res.status(500).json({ error: "Internal server error" });
});
