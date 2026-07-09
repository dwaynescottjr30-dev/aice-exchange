'use strict';

/**
 * routes/accounts.js
 *
 * POST /api/auth/login    — create account or log in (name + PIN)
 * POST /api/auth/logout   — invalidate session token
 * GET  /api/account       — full account snapshot (auth required)
 * POST /api/account/reset — reset to starting cash (auth required)
 * GET  /api/leaderboard   — top 10 by net worth (public)
 */

const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const db        = require('../db');
const { createSession, deleteSession, requireAuth } = require('../auth');
const { getState }     = require('../stateStore');
const { STARTING_CASH, usdValue, usdAsk, liveRate } = require('../market');

const BCRYPT_ROUNDS = 10;
const CURRENCY_LABELS = { Dracos:'Draco', Jools:'Jool', Glint:'Glint', Flux:'Flux', OStar:'O$', Ash:'Ash' };

// ── Login / Register ────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { name, pin, currency = 'OStar' } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN are required.' });
  if (!/^[0-9]{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–6 digits.' });
  if (name.length > 40) return res.status(400).json({ error: 'Name too long.' });

  try {
    const { rows } = await db.query('SELECT * FROM accounts WHERE name = $1', [name]);

    let account;
    if (rows.length) {
      // Existing account — verify PIN
      account = rows[0];
      const ok = await bcrypt.compare(pin, account.pin_hash);
      if (!ok) return res.status(401).json({ error: "That PIN doesn't match this account." });
    } else {
      // New account — create it
      const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      const { rows: created } = await db.query(
        `INSERT INTO accounts (name, pin_hash, currency, cash_usd)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, pinHash, currency, STARTING_CASH]
      );
      account = created[0];
    }

    const token = createSession(account.id, account.name, account.currency);
    res.json({
      ok:       true,
      token,
      name:     account.name,
      currency: account.currency,
      new:      rows.length === 0,
    });
  } catch (err) {
    console.error('[accounts/login]', err.message);
    res.status(500).json({ error: 'Server error — try again.' });
  }
});

// ── Logout ──────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  if (req.token) deleteSession(req.token);
  res.json({ ok: true });
});

// ── Account snapshot ────────────────────────────────────────────────────────
router.get('/account', requireAuth, async (req, res) => {
  const { accountId, currency } = req.session;
  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market not ready.' });

  try {
    const { rows: [acc] } = await db.query(
      'SELECT id, name, currency, cash_usd, created_at FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!acc) return res.status(404).json({ error: 'Account not found.' });

    const { rows: holdings } = await db.query(
      'SELECT ticker, shares, avg_cost_usd FROM holdings WHERE account_id = $1 AND shares > 0',
      [accountId]
    );
    const { rows: shorts } = await db.query(
      'SELECT ticker, shares, entry_price_usd FROM shorts WHERE account_id = $1 AND shares > 0',
      [accountId]
    );
    const { rows: orders } = await db.query(
      'SELECT id, ticker, action, qty, limit_usd, created_at FROM pending_orders WHERE account_id = $1 ORDER BY created_at DESC',
      [accountId]
    );
    const { rows: txs } = await db.query(
      `SELECT action, ticker, qty, price_usd, total_usd, settle_currency, created_at
       FROM transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 40`,
      [accountId]
    );

    // Compute net worth in USD
    let holdingsUsd = 0;
    for (const h of holdings) {
      const c = s.companies.find(x => x.ticker === h.ticker);
      if (c) holdingsUsd += usdValue(c.price, c.currency, s) * h.shares;
    }
    let shortPnlUsd = 0;
    for (const sh of shorts) {
      const c = s.companies.find(x => x.ticker === sh.ticker);
      if (c) shortPnlUsd += (sh.entry_price_usd - usdAsk(c, s)) * sh.shares;
    }

    res.json({
      id:         acc.id,
      name:       acc.name,
      currency:   acc.currency,
      cashUsd:    acc.cash_usd,
      createdAt:  acc.created_at,
      holdings,
      shorts,
      pendingOrders: orders,
      transactions:  txs,
      summary: {
        cashUsd:       acc.cash_usd,
        holdingsUsd,
        shortPnlUsd,
        netWorthUsd:   acc.cash_usd + holdingsUsd + shortPnlUsd,
        startingCash:  STARTING_CASH,
      },
    });
  } catch (err) {
    console.error('[accounts/account]', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Reset account ────────────────────────────────────────────────────────────
router.post('/account/reset', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  try {
    await db.query('DELETE FROM holdings       WHERE account_id = $1', [accountId]);
    await db.query('DELETE FROM shorts         WHERE account_id = $1', [accountId]);
    await db.query('DELETE FROM pending_orders WHERE account_id = $1', [accountId]);
    await db.query('UPDATE accounts SET cash_usd = $1 WHERE id = $2', [STARTING_CASH, accountId]);
    await db.query(
      `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd)
       VALUES ($1, 'reset', 'ACCOUNT', 0, 0, 0)`,
      [accountId]
    );
    res.json({ ok: true, cashUsd: STARTING_CASH });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Leaderboard (public) ─────────────────────────────────────────────────────
router.get('/leaderboard', async (_req, res) => {
  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market not ready.' });

  try {
    const { rows: accounts } = await db.query(
      'SELECT id, name, currency, cash_usd FROM accounts LIMIT 50'
    );

    const board = [];
    for (const acc of accounts) {
      const { rows: holdings } = await db.query(
        'SELECT ticker, shares FROM holdings WHERE account_id = $1 AND shares > 0',
        [acc.id]
      );
      const { rows: shorts } = await db.query(
        'SELECT ticker, shares, entry_price_usd FROM shorts WHERE account_id = $1 AND shares > 0',
        [acc.id]
      );

      let holdingsUsd = 0;
      for (const h of holdings) {
        const c = s.companies.find(x => x.ticker === h.ticker);
        if (c) holdingsUsd += usdValue(c.price, c.currency, s) * h.shares;
      }
      let shortPnlUsd = 0;
      for (const sh of shorts) {
        const c = s.companies.find(x => x.ticker === sh.ticker);
        if (c) shortPnlUsd += (sh.entry_price_usd - usdAsk(c, s)) * sh.shares;
      }

      board.push({
        name:        acc.name,
        currency:    acc.currency,
        netWorthUsd: acc.cash_usd + holdingsUsd + shortPnlUsd,
      });
    }

    board.sort((a, b) => b.netWorthUsd - a.netWorthUsd);
    res.json(board.slice(0, 10));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
