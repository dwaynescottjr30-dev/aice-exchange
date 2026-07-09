'use strict';

/**
 * routes/trade.js
 *
 * POST /api/trade/buy      — market or limit buy
 * POST /api/trade/sell     — market or limit sell
 * POST /api/trade/short    — open short position
 * POST /api/trade/cover    — cover short position
 * DELETE /api/trade/orders/:id — cancel a pending limit order
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../auth');
const { getState } = require('../stateStore');
const { usdAsk, usdBid } = require('../market');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
async function getAccount(accountId) {
  const { rows } = await db.query(
    'SELECT id, cash_usd, currency FROM accounts WHERE id = $1',
    [accountId]
  );
  return rows[0] ?? null;
}

async function getHolding(accountId, ticker) {
  const { rows } = await db.query(
    'SELECT shares, avg_cost_usd FROM holdings WHERE account_id = $1 AND ticker = $2',
    [accountId, ticker]
  );
  return rows[0] ?? null;
}

async function getShort(accountId, ticker) {
  const { rows } = await db.query(
    'SELECT shares, entry_price_usd FROM shorts WHERE account_id = $1 AND ticker = $2',
    [accountId, ticker]
  );
  return rows[0] ?? null;
}

async function logTx(accountId, action, ticker, qty, priceUsd, totalUsd, currency) {
  await db.query(
    `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd, settle_currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [accountId, action, ticker, qty, priceUsd, totalUsd, currency]
  );
}

// ─────────────────────────────────────────────
//  BUY
// ─────────────────────────────────────────────
router.post('/buy', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { ticker, qty: rawQty, limitPrice } = req.body;
  const qty = Math.max(1, parseInt(rawQty, 10) || 1);

  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market not ready.' });

  const c = s.companies.find(x => x.ticker === ticker);
  if (!c)          return res.status(404).json({ error: `Ticker ${ticker} not found.` });
  if (c.delisted)  return res.status(400).json({ error: `${ticker} is delisted — trading halted.` });

  const acc = await getAccount(accountId);
  if (!acc) return res.status(404).json({ error: 'Account not found.' });

  // ── Limit order ──────────────────────────────────────────────────────────
  if (limitPrice != null) {
    const limitUsd = parseFloat(limitPrice) * (1); // caller sends in USD
    if (!(limitUsd > 0)) return res.status(400).json({ error: 'Invalid limit price.' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO pending_orders (id, account_id, ticker, action, qty, limit_usd)
       VALUES ($1, $2, $3, 'buy', $4, $5)`,
      [id, accountId, ticker, qty, limitUsd]
    );
    return res.json({ ok: true, type: 'limit', orderId: id, message: `Limit buy queued: ${qty} ${ticker} at or below $${limitUsd.toFixed(2)}.` });
  }

  // ── Market order ─────────────────────────────────────────────────────────
  const priceUsd = usdAsk(c, s);
  const total    = priceUsd * qty;
  if (total > acc.cash_usd) {
    return res.status(400).json({
      error: `Not enough cash — need $${total.toFixed(2)}, have $${acc.cash_usd.toFixed(2)}.`,
    });
  }

  await db.query('UPDATE accounts SET cash_usd = cash_usd - $1 WHERE id = $2', [total, accountId]);

  const existing = await getHolding(accountId, ticker);
  if (existing) {
    const newShares  = existing.shares + qty;
    const newAvgCost = (existing.avg_cost_usd * existing.shares + priceUsd * qty) / newShares;
    await db.query(
      'UPDATE holdings SET shares = $1, avg_cost_usd = $2 WHERE account_id = $3 AND ticker = $4',
      [newShares, newAvgCost, accountId, ticker]
    );
  } else {
    await db.query(
      'INSERT INTO holdings (account_id, ticker, shares, avg_cost_usd) VALUES ($1, $2, $3, $4)',
      [accountId, ticker, qty, priceUsd]
    );
  }

  await logTx(accountId, 'buy', ticker, qty, priceUsd, total, acc.currency);
  res.json({ ok: true, type: 'market', qty, ticker, priceUsd, total,
    message: `Bought ${qty} share${qty === 1 ? '' : 's'} of ${ticker} at ask.` });
});

// ─────────────────────────────────────────────
//  SELL
// ─────────────────────────────────────────────
router.post('/sell', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { ticker, qty: rawQty, limitPrice, settleCurrency } = req.body;
  const qty = Math.max(1, parseInt(rawQty, 10) || 1);

  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market not ready.' });

  const c = s.companies.find(x => x.ticker === ticker);
  if (!c)         return res.status(404).json({ error: `Ticker ${ticker} not found.` });
  if (c.delisted) return res.status(400).json({ error: `${ticker} is delisted.` });

  const acc      = await getAccount(accountId);
  const existing = await getHolding(accountId, ticker);
  if (!existing || existing.shares < qty) {
    return res.status(400).json({ error: `You only own ${existing?.shares ?? 0} shares of ${ticker}.` });
  }

  // ── Limit order ──────────────────────────────────────────────────────────
  if (limitPrice != null) {
    const limitUsd = parseFloat(limitPrice);
    if (!(limitUsd > 0)) return res.status(400).json({ error: 'Invalid limit price.' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO pending_orders (id, account_id, ticker, action, qty, limit_usd)
       VALUES ($1, $2, $3, 'sell', $4, $5)`,
      [id, accountId, ticker, qty, limitUsd]
    );
    return res.json({ ok: true, type: 'limit', orderId: id, message: `Limit sell queued: ${qty} ${ticker} at or above $${limitUsd.toFixed(2)}.` });
  }

  // ── Market order ─────────────────────────────────────────────────────────
  const priceUsd = usdBid(c, s);
  const total    = priceUsd * qty;
  const settle   = settleCurrency || acc.currency;

  await db.query('UPDATE accounts SET cash_usd = cash_usd + $1 WHERE id = $2', [total, accountId]);

  const newShares = existing.shares - qty;
  if (newShares <= 0) {
    await db.query('DELETE FROM holdings WHERE account_id = $1 AND ticker = $2', [accountId, ticker]);
  } else {
    await db.query(
      'UPDATE holdings SET shares = $1 WHERE account_id = $2 AND ticker = $3',
      [newShares, accountId, ticker]
    );
  }

  await logTx(accountId, 'sell', ticker, qty, priceUsd, total, settle);
  res.json({ ok: true, type: 'market', qty, ticker, priceUsd, total,
    message: `Sold ${qty} share${qty === 1 ? '' : 's'} of ${ticker} at bid.` });
});

// ─────────────────────────────────────────────
//  SHORT
// ─────────────────────────────────────────────
router.post('/short', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { ticker, qty: rawQty } = req.body;
  const qty = Math.max(1, parseInt(rawQty, 10) || 1);

  const s = getState();
  const c = s?.companies.find(x => x.ticker === ticker);
  if (!c)         return res.status(404).json({ error: `Ticker ${ticker} not found.` });
  if (c.delisted) return res.status(400).json({ error: `${ticker} is delisted.` });

  const acc = await getAccount(accountId);
  if (!acc) return res.status(404).json({ error: 'Account not found.' });

  const entryUsd   = usdBid(c, s);
  const collateral = entryUsd * qty * 0.5; // 50% margin requirement
  if (collateral > acc.cash_usd) {
    return res.status(400).json({
      error: `Need $${collateral.toFixed(2)} in collateral (50% of position) — you have $${acc.cash_usd.toFixed(2)}.`,
    });
  }

  const existing = await getShort(accountId, ticker);
  if (existing) {
    const ns       = existing.shares + qty;
    const newEntry = (existing.entry_price_usd * existing.shares + entryUsd * qty) / ns;
    await db.query(
      'UPDATE shorts SET shares = $1, entry_price_usd = $2 WHERE account_id = $3 AND ticker = $4',
      [ns, newEntry, accountId, ticker]
    );
  } else {
    await db.query(
      'INSERT INTO shorts (account_id, ticker, shares, entry_price_usd) VALUES ($1, $2, $3, $4)',
      [accountId, ticker, qty, entryUsd]
    );
  }

  await logTx(accountId, 'short', ticker, qty, entryUsd, entryUsd * qty, acc.currency);
  res.json({ ok: true, qty, ticker, entryUsd, message: `Opened short: ${qty} ${ticker} @ $${entryUsd.toFixed(2)}.` });
});

// ─────────────────────────────────────────────
//  COVER
// ─────────────────────────────────────────────
router.post('/cover', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { ticker, qty: rawQty } = req.body;
  const qty = Math.max(1, parseInt(rawQty, 10) || 1);

  const s = getState();
  const c = s?.companies.find(x => x.ticker === ticker);
  if (!c) return res.status(404).json({ error: `Ticker ${ticker} not found.` });

  const acc   = await getAccount(accountId);
  const short = await getShort(accountId, ticker);
  if (!short || short.shares < qty) {
    return res.status(400).json({ error: `You don't have a short of ${qty} shares on ${ticker}.` });
  }

  const coverUsd  = usdAsk(c, s);
  const pnl       = (short.entry_price_usd - coverUsd) * qty;

  await db.query('UPDATE accounts SET cash_usd = cash_usd + $1 WHERE id = $2', [pnl, accountId]);

  const newShares = short.shares - qty;
  if (newShares <= 0) {
    await db.query('DELETE FROM shorts WHERE account_id = $1 AND ticker = $2', [accountId, ticker]);
  } else {
    await db.query(
      'UPDATE shorts SET shares = $1 WHERE account_id = $2 AND ticker = $3',
      [newShares, accountId, ticker]
    );
  }

  await logTx(accountId, 'cover', ticker, qty, coverUsd, pnl, acc.currency);
  res.json({
    ok: true, qty, ticker, coverUsd, pnl,
    message: `Covered ${qty} ${ticker} — realized ${pnl >= 0 ? 'gain' : 'loss'} of $${Math.abs(pnl).toFixed(2)}.`,
  });
});

// ─────────────────────────────────────────────
//  CANCEL LIMIT ORDER
// ─────────────────────────────────────────────
router.delete('/orders/:id', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { id } = req.params;

  const { rowCount } = await db.query(
    'DELETE FROM pending_orders WHERE id = $1 AND account_id = $2',
    [id, accountId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Order not found or already filled.' });
  res.json({ ok: true });
});

module.exports = router;
