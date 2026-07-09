'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const { loadState }        = require('./stateStore');
const { sessionMiddleware } = require('./auth');
const scheduler             = require('./scheduler');

const marketRouter   = require('./routes/market');
const eventsRouter   = require('./routes/events');
const accountsRouter = require('./routes/accounts');
const tradeRouter    = require('./routes/trade');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
//  Security & middleware
// ─────────────────────────────────────────────
app.use(helmet());

// CORS — allow your website origin plus localhost for development
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://eplchronicles.com,http://localhost:3000')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '32kb' }));

// Global rate limit — 120 req / min per IP
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

// Attach session to every request
app.use(sessionMiddleware);

// ─────────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────────
app.use('/api/market',        marketRouter);
app.use('/api/events',        eventsRouter);
app.use('/api/auth',          accountsRouter);   // login + logout
app.use('/api',               accountsRouter);   // /api/account, /api/leaderboard
app.use('/api/trade',         tradeRouter);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
(async () => {
  try {
    await loadState();
    scheduler.start();

    app.listen(PORT, () => {
      console.log(`[server] AICE Exchange API listening on port ${PORT}`);
      console.log(`[server] tick interval: ${process.env.TICK_SECONDS ?? 30}s`);
      console.log(`[server] CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
    });
  } catch (err) {
    console.error('[server] fatal startup error:', err);
    process.exit(1);
  }
})();
