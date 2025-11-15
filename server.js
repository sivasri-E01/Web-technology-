// aurachef-backend/server.js

import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// IMPORTANT: load .env immediately so imported modules can read process.env
dotenv.config();

import connectDB from './config/db.js';

// Route imports
import userRoutes from './routes/userRoutes.js';
import recipeRoutes from './routes/recipeRoutes.js';
import orderRoutes from './routes/orderRoutes.js';

// --- CTO MANDATE: "ALUMINA" STYLE PRE-FLIGHT CHECK ---
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey || geminiApiKey.length < 30) { // slightly stronger plausibility check
    console.error("\n" + "=".repeat(60));
    console.error("FATAL ERROR: GEMINI_API_KEY is missing or invalid in your .env file.");
    console.error("Please ensure the .env file exists and contains a valid Google Gemini API key.");
    console.error("=".repeat(60) + "\n");
    process.exit(1); // Stop the server with an explicit error code
}
// --- END OF CHECK ---

// Connect to the database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/orders', orderRoutes);

// Static Asset Serving (Frontend)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '/public')));
app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

const BASE_PORT = Number(process.env.PORT) || 5000;
const MAX_PORT_ATTEMPTS = 10;

function startServer(port, attempt = 0) {
    const server = app.listen(port, () => {
        console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${port}`);
        console.log("Gemini API Key loaded successfully.");
    });
    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
            console.warn(`Port ${port} is in use. Trying ${port + 1}...`);
            setTimeout(() => startServer(port + 1, attempt + 1), 200);
        } else {
            console.error('Failed to start server:', err?.message || err);
            process.exit(1);
        }
    });
}

startServer(BASE_PORT);
