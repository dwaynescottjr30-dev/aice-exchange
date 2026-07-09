# Deploy AICE Exchange Server to Railway

## One-time setup (10 minutes)

### Step 1 — Push to GitHub

Open PowerShell or Command Prompt in this folder (`exchange-server`) and run:

```powershell
git init
git add .
git commit -m "AICE exchange server"
```

Then go to github.com → New repository → name it `aice-exchange` → Create.
Copy the two lines it gives you starting with `git remote add origin …` and run them.

### Step 2 — Create Railway project

1. Go to **railway.app** and sign in (GitHub login is easiest)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `aice-exchange` repo
4. Railway will detect Node.js and start building automatically

### Step 3 — Add PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway automatically sets the `DATABASE_URL` environment variable

### Step 4 — Set environment variables

In Railway: click your service → **Variables** tab → add these:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key |
| `ADMIN_KEY` | any long random string (your secret admin password) |
| `CORS_ORIGINS` | `https://eplchronicles.com` |
| `TICK_SECONDS` | `30` |
| `DATABASE_SSL` | `true` |
| `NODE_ENV` | `production` |

### Step 5 — Run the database schema

1. In Railway: click your PostgreSQL service → **Data** tab → **Query**
2. Copy and paste the contents of `schema.sql` and run it

OR from the Railway service shell:
```bash
psql $DATABASE_URL -f schema.sql
```

### Step 6 — Get your URL and update the website

Railway gives you a URL like `https://aice-exchange-production.up.railway.app`.

Open `Elysium Website/exchange.html` and update line ~170:
```js
const AICE_API = 'https://YOUR-RAILWAY-URL.up.railway.app';
```

Then redeploy the site:
```
python deploy_to_cloudflare.py
```

---

## Free tier limits

Railway's free tier (Hobby plan, $5/month) handles this easily:
- The server is lightweight — mostly sleep + 30s tick cycles
- PostgreSQL state is tiny (prices + accounts, no big data)
- The $5/month plan is enough for production traffic

---

## Testing the live server

Once deployed, test with:
```
curl https://YOUR-URL.up.railway.app/health
curl https://YOUR-URL.up.railway.app/api/market/status
```
