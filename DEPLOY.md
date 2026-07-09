# Argos & Igoine Continental Exchange — Deployment Guide

## What this is

A Node.js + Express + PostgreSQL server that runs the AICE stock market 24/7.
It exposes a REST API your website calls for market data, trading, and AI-priced events.
The Anthropic API key stays server-side — it never touches the browser.

---

## Quick local test

```bash
cd "exchange-server"
npm install

# Create a local Postgres DB
createdb aice_exchange
psql -d aice_exchange -f schema.sql

# Copy and fill in env vars
cp .env.example .env
# Edit .env — set DATABASE_URL, ANTHROPIC_API_KEY, ADMIN_KEY

npm start
# → server listening on http://localhost:3001
```

Test it:
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/market/status
curl http://localhost:3001/api/market | python3 -m json.tool | head -40
```

---

## Recommended hosting: Railway (easiest)

1. Push `exchange-server/` to its own GitHub repo (or a subfolder).
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub.
3. Add a **PostgreSQL** plugin — Railway auto-sets `DATABASE_URL`.
4. In **Variables**, add:
   - `ANTHROPIC_API_KEY` — your Anthropic key
   - `ADMIN_KEY` — a random 64-char hex string
   - `CORS_ORIGINS` — `https://eplchronicles.com`
   - `TICK_SECONDS` — `30`
   - `DATABASE_SSL` — `true`
   - `NODE_ENV` — `production`
5. Railway runs the schema migration for you if you add this to `package.json` scripts:
   ```json
   "migrate": "psql $DATABASE_URL -f schema.sql"
   ```
   Then set **Deploy Command** to `npm run migrate && npm start`.

Your API will be live at something like `https://aice-exchange.up.railway.app`.

---

## Alternative: Render

Same idea — add a Web Service, link a PostgreSQL instance, set env vars.
Set **Start Command** to `node server.js`.
Run `psql $DATABASE_URL -f schema.sql` once in the Render Shell tab.

---

## Wiring up the website

Once deployed, your website's exchange page needs to call your server instead of
running the simulation locally.  Key API endpoints:

| Endpoint | Method | Auth? | Purpose |
|---|---|---|---|
| `/api/market` | GET | No | Full market snapshot (companies, index, rates) |
| `/api/market/status` | GET | No | Open/closed status |
| `/api/events` | POST | Yes | Submit a market event (AI prices it) |
| `/api/auth/login` | POST | No | Login or create account |
| `/api/auth/logout` | POST | Yes | Invalidate session |
| `/api/account` | GET | Yes | Your holdings, cash, P&L |
| `/api/account/reset` | POST | Yes | Reset to starting cash |
| `/api/trade/buy` | POST | Yes | Buy shares (market or limit) |
| `/api/trade/sell` | POST | Yes | Sell shares (market or limit) |
| `/api/trade/short` | POST | Yes | Open a short position |
| `/api/trade/cover` | POST | Yes | Cover a short position |
| `/api/trade/orders/:id` | DELETE | Yes | Cancel a limit order |
| `/api/leaderboard` | GET | No | Top 10 by net worth |

**Auth flow:** POST `/api/auth/login` with `{ name, pin }` → returns `{ token }`.
Send `Authorization: Bearer <token>` on all subsequent requests.

---

## Tick schedule

The cron fires every `TICK_SECONDS` seconds.  During market hours
(Monday–Friday 9:30am–4:00pm server local time) it advances one tick.
Outside hours the cron runs but prices don't move.

To adjust tick speed without redeploying, change `TICK_SECONDS` in your
Railway/Render environment variables and redeploy.

---

## Admin endpoints

Require header `x-admin-key: <your ADMIN_KEY>`.

- `POST /api/market/tick` — force one tick immediately
- `POST /api/market/reset` — wipe prices back to opening values

---

## Security notes

- Anthropic API key is **server-side only** — the browser never sees it.
- PINs are stored as **bcrypt hashes** (cost=10) — never plaintext.
- CORS is restricted to your `CORS_ORIGINS` list.
- Rate limits: 120 req/min global; 1 event dispatch per 10s.
- The old R2 credentials in `upload_to_r2.py` should be **revoked** in your
  Cloudflare dashboard (they were shared in chat).
