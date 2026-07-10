'use strict';

/**
 * routes/payment.js
 *
 * POST /api/payment/create-session  — create a Stripe Checkout session ($1 upgrade)
 * POST /api/payment/verify          — verify session after Stripe redirect, upgrade account
 *
 * Environment variables required (add in Railway → Variables):
 *   STRIPE_SECRET_KEY   sk_live_... or sk_test_...
 *
 * No webhook needed — we verify the session server-side on redirect.
 */

const router  = require('express').Router();
const db      = require('../db');
const { requireAuth } = require('../auth');

// Lazy-initialise Stripe so the server still boots without the key
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
  _stripe = require('stripe')(key);
  return _stripe;
}

const UPGRADE_PRICE_CENTS = 100; // $1.00
const GOLD_KG_USD = 133130.78;
const PAID_TIER_DRACOS = 500;
const PAID_TIER_USD = PAID_TIER_DRACOS * GOLD_KG_USD; // ≈ 66,565,390 (500 Dracos)

// ── Create Checkout session ──────────────────────────────────────────────────
router.post('/create-session', requireAuth, async (req, res) => {
  const { accountId, name } = req.session;
  const { cancelUrl } = req.body;

  if (!cancelUrl) {
    return res.status(400).json({ error: 'cancelUrl is required.' });
  }

  try {
    // Reject if already paid
    const { rows: [acc] } = await db.query(
      'SELECT tier FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    if (acc.tier === 'paid') {
      return res.status(400).json({ error: 'Your account is already on the Standard tier.' });
    }

    const stripe  = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: UPGRADE_PRICE_CENTS,
          product_data: {
            name: 'AICE Standard Broker Account',
            description: 'Upgrade from 5 Dracos free tier to 500 ◈ Dracos trading capital',
          },
        },
        quantity: 1,
      }],
      metadata: {
        account_id:  String(accountId),
        broker_name: name,
      },
      // Stripe replaces {CHECKOUT_SESSION_ID} automatically
      success_url: `${cancelUrl}?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[payment/create-session]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Verify session after Stripe redirect ─────────────────────────────────────
// Called by exchange.html when it sees ?session_id= in the URL.
// Retrieves the session from Stripe, confirms payment_status = 'paid',
// then upgrades the account. Idempotent — safe to call more than once.
router.post('/verify', requireAuth, async (req, res) => {
  const { accountId } = req.session;
  const { sessionId }  = req.body;

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required.' });

  try {
    const stripe  = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify this session belongs to this account
    if (session.metadata?.account_id !== String(accountId)) {
      return res.status(403).json({ error: 'Session does not belong to this account.' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed.' });
    }

    // Upgrade — idempotent ON CONFLICT style via simple check
    await db.query(
      `UPDATE accounts SET tier = 'paid', cash_usd = $2 WHERE id = $1 AND tier = 'free'`,
      [accountId, PAID_TIER_USD]
    );

    console.log(`[payment/verify] Account ${accountId} upgraded to paid tier (${PAID_TIER_DRACOS} Dracos)`);
    res.json({ ok: true, tier: 'paid', cashUsd: PAID_TIER_USD, cashDracos: PAID_TIER_DRACOS });
  } catch (err) {
    console.error('[payment/verify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
