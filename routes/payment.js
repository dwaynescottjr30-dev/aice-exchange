'use strict';

/**
 * routes/payment.js
 *
 * POST /api/payment/create-session  — create a Stripe Checkout session ($1 upgrade)
 * POST /api/payment/webhook         — Stripe webhook (marks account as paid, sets O$50,000)
 *
 * Environment variables required (add in Railway → Variables):
 *   STRIPE_SECRET_KEY        sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...  (from Stripe Dashboard → Webhooks)
 *
 * Stripe Checkout success → redirects to exchange.html?upgraded=1
 */

const router  = require('express').Router();
const db      = require('../db');
const { requireAuth } = require('../auth');

// Lazy-initialise Stripe so the server still boots without the key (shows a helpful error instead)
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
  _stripe = require('stripe')(key);
  return _stripe;
}

const UPGRADE_PRICE_USD = 100; // Stripe uses cents → $1.00

// ── Create Checkout session ──────────────────────────────────────────────────
router.post('/create-session', requireAuth, async (req, res) => {
  const { accountId, name } = req.session;
  const { successUrl, cancelUrl } = req.body;

  if (!successUrl || !cancelUrl) {
    return res.status(400).json({ error: 'successUrl and cancelUrl are required.' });
  }

  try {
    // Check if already paid
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
          unit_amount: UPGRADE_PRICE_USD,
          product_data: {
            name: 'AICE Standard Broker Account',
            description: 'Upgrade from 5 Dracos free tier to O$50,000 trading capital',
          },
        },
        quantity: 1,
      }],
      metadata: {
        account_id:   String(accountId),
        broker_name:  name,
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[payment/create-session]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Webhook ───────────────────────────────────────────────────────────
// NOTE: This route receives the raw body (set up in server.js BEFORE express.json()).
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[payment/webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
    return res.status(500).json({ error: 'Webhook secret not configured.' });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (err) {
    console.error('[payment/webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session   = event.data.object;
    const accountId = parseInt(session.metadata?.account_id, 10);

    if (!accountId) {
      console.error('[payment/webhook] No account_id in session metadata');
      return res.status(200).json({ received: true }); // acknowledge to Stripe
    }

    try {
      // Upgrade account: set tier = paid, cash = O$50,000
      await db.query(
        `UPDATE accounts SET tier = 'paid', cash_usd = 50000.0 WHERE id = $1`,
        [accountId]
      );
      console.log(`[payment/webhook] Account ${accountId} upgraded to paid tier`);
    } catch (err) {
      console.error('[payment/webhook] DB update failed:', err.message);
      return res.status(500).json({ error: 'DB update failed.' });
    }
  }

  res.status(200).json({ received: true });
});

module.exports = router;
