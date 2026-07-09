'use strict';

/**
 * routes/events.js
 *
 * POST /api/events   — submit a market event; calls Anthropic server-side
 *                      and prices the effect into the live state.
 *
 * This is the ONLY place the Anthropic API key is used — it never leaves
 * the server.  The browser prototype called api.anthropic.com directly
 * (key exposed), which is what this replaces.
 */

const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../auth');
const { getState, saveState } = require('../stateStore');
const { updateIndex, liveRate, usdValue } = require('../market');

// One event per 10 seconds per IP (mirrors prototype's intent)
const eventLimiter = rateLimit({
  windowMs: 10_000,
  max:      1,
  message:  { error: 'Slow down — one dispatch at a time.' },
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(s) {
  const GOLD_KG_USD = 133130.78;
  const tickers = s.companies
    .filter(c => !c.delisted)
    .map(c => `${c.ticker} (${c.name}, ${c.sector}, ${c.region}, ${c.currency})`)
    .join('\n');

  return `You are the Argos & Igoine Continental Exchange market-desk AI.
Your world is a fictional continent (Argos + Igoine) with its own currencies:
 • Draco — backed by gold (1 Draco = 1 kg gold ≈ $${GOLD_KG_USD.toLocaleString()})
 • Jool  — pegged to 0.01 kg gold
 • Glint, Flux — fractional gold derivatives
 • O★ (OStar) — internal reference unit (1:1 USD)
 • Ash — volatile shadow currency

Current currency confidence modifiers:
 • goldMod=${s.goldMod.toFixed(3)} joolPegMod=${s.joolPegMod.toFixed(3)} starMod=${s.starMod.toFixed(3)} ashShadow=${s.ashShadow.toFixed(3)}

Listed companies (ticker, name, sector, region, currency):
${tickers}

You may also affect currencies with these special tickers:
 CURRENCY:Dracos  CURRENCY:Jools  CURRENCY:OStar

A user will give you a market event.  Return a JSON array of effects.
Each element: {"ticker":"XXXX","pct":<number -25 to +25>,"reason":"<short explanation>"}
Only include tickers that are meaningfully affected.
Respond ONLY with the JSON array — no markdown, no explanation outside it.`;
}

router.post('/', requireAuth, eventLimiter, async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'Event text is required (5+ characters).' });
  }

  const s = getState();
  if (!s) return res.status(503).json({ error: 'Market not ready.' });

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     buildSystemPrompt(s),
      messages:   [{ role: 'user', content: text.trim() }],
    });

    const raw     = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let effects = [];
    try { effects = JSON.parse(cleaned); } catch { effects = []; }
    if (!Array.isArray(effects)) effects = [];

    const validTickers  = new Set(s.companies.map(c => c.ticker));
    const CURRENCY_KEYS = new Set(['CURRENCY:Dracos', 'CURRENCY:Jools', 'CURRENCY:OStar']);

    effects = effects
      .filter(e => e && typeof e.pct === 'number' && (validTickers.has(e.ticker) || CURRENCY_KEYS.has(e.ticker)))
      .map(e => ({
        ticker: e.ticker,
        pct:    Math.max(-25, Math.min(25, e.pct)),
        reason: (e.reason || '').slice(0, 120),
      }));

    // Apply effects to live state
    effects.forEach(e => {
      if (CURRENCY_KEYS.has(e.ticker)) {
        const mult = 1 + e.pct / 100;
        if (e.ticker === 'CURRENCY:Dracos') s.goldMod     = Math.min(1.6, Math.max(0.5, s.goldMod     * mult));
        if (e.ticker === 'CURRENCY:Jools')  s.joolPegMod  = Math.min(1.5, Math.max(0.5, s.joolPegMod  * mult));
        if (e.ticker === 'CURRENCY:OStar')  s.starMod     = Math.min(1.8, Math.max(0.4, s.starMod     * mult));
        return;
      }
      const c = s.companies.find(x => x.ticker === e.ticker);
      if (!c) return;
      const immediate = e.pct * 0.65;
      const residual  = e.pct * 0.35;
      c.price        = Math.max(c.price * (1 + immediate / 100), c.price * 0.05, 0.01);
      c.changePct    = immediate;
      c.history.push(c.price);
      if (c.history.length > 24) c.history.shift();
      c.driftBias      = residual / 3;
      c.driftTicksLeft = 3;
    });

    s.events = s.events || [];
    s.events.unshift({ time: new Date().toISOString(), text: text.trim(), effects });
    if (s.events.length > 30) s.events.length = 30;

    updateIndex(s);
    await saveState();

    res.json({
      ok:      true,
      effects,
      moved:   effects.length,
      message: effects.length
        ? `Priced in — ${effects.length} ticker${effects.length === 1 ? '' : 's'} moved.`
        : "Desk concluded this event doesn't move the market.",
    });
  } catch (err) {
    console.error('[events] Anthropic error:', err.message);
    res.status(502).json({ error: "Couldn't reach the wire service. Try again." });
  }
});

// List recent events (public)
router.get('/', (_req, res) => {
  const s = getState();
  res.json((s?.events || []).slice(0, 30));
});

module.exports = router;
