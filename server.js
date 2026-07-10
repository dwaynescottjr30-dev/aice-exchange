'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const fs                    = require('fs');
const path                  = require('path');
const db                    = require('./db');
const { loadState }        = require('./stateStore');
const { sessionMiddleware } = require('./auth');
const scheduler             = require('./scheduler');

const marketRouter   = require('./routes/market');
const eventsRouter   = require('./routes/events');
const accountsRouter = require('./routes/accounts');
const tradeRouter    = require('./routes/trade');
const paymentRouter  = require('./routes/payment');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://eplchronicles.com,http://localhost:3000')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '32kb' }));

app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.use(sessionMiddleware);

app.use('/api/market',        marketRouter);
app.use('/api/events',        eventsRouter);
app.use('/api/auth',          accountsRouter);
app.use('/api',               accountsRouter);
app.use('/api/trade',         tradeRouter);
app.use('/api/payment',       paymentRouter);

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('[server] schema applied');

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
