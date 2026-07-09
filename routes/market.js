'use strict';

/**
 * routes/market.js
 *
 * GET  /api/market          — full public market snapshot
 * GET  /api/market/status   — open/closed + next-open label
 * POST /api/market/tick     — force one tick (dev/admin, requires ADMIN_KEY header)
 * POST /api/market/reset    — reset to opening prices (dev/admin)
 */

const router  = require('express').Router();
const { getState, saveState, setState } = require('../stateStore');
const { doTick } = require('../scheduler');
const { isMarketOpen, nextOpenLabel, buildInitialState } = require('../market');

function adminGuard(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden — admin key required.' });
  }
  next();
}

// Full market snapshot (public — anyone can poll this)
router.get('/', (req, res) => {
  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market state not yet loaded.' });
  res.json({
    tickCount:    s.tickCount,
    indexValue:   s.indexValue,
    indexHistory: s.indexHistory,
    goldMod:      s.goldMod,
    joolPegMod:   s.joolPegMod,
    starMod:      s.starMod,
    ashShadow:    s.ashShadow,
    companies:    s.companies,
    events:       (s.events || []).slice(0, 30),
    delistings:   s.delistings || [],
    marketOpen:   isMarketOpen(),
    nextOpen:     isMarketOpen() ? null : nextOpenLabel(),
    lastRealMs:   s.lastRealMs,
  });
});

// Lightweight status check (no company data)
router.get('/status', (_req, res) => {
  const open = isMarketOpen();
  res.json({ open, nextOpen: open ? null : nextOpenLabel() });
});

// Admin: force one tick immediately
router.post('/tick', adminGuard, async (req, res) => {
  try {
    await doTick();
    res.json({ ok: true, tickCount: getState().tickCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: reset market to opening prices
router.post('/reset', adminGuard, async (req, res) => {
  try {
    const fresh = buildInitialState();
    setState(fresh);
    await saveState();
    res.json({ ok: true, message: 'Market reset to opening prices.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
