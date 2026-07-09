/**
 * market.js — Argos & Igoine Continental Exchange tick engine
 *
 * Ported faithfully from exchange_simulation.js (browser prototype).
 * All browser-specific rendering has been stripped; only the business
 * logic that belongs on the server lives here.
 */

'use strict';

// ─────────────────────────────────────────────
//  Currency baseline  (same constants as prototype)
// ─────────────────────────────────────────────
const GOLD_KG_USD = 133130.78;

// How many USD one unit of each currency is nominally worth.
const NOMINAL_RATES = {
  Dracos:  GOLD_KG_USD,          // 1 Draco = 1 kg of gold
  Jools:   GOLD_KG_USD / 100,    // 1 Jool = 0.01 kg of gold
  Glint:   GOLD_KG_USD / 10000,  // fractional
  Flux:    GOLD_KG_USD / 100000, // micro
  OStar:   1.0,                  // O★ is the internal USD stand-in (1:1)
  Ash:     1.15,                 // baseline — drifts in-sim
};

/** Live USD-equivalent for a given currency key, reflecting modifiers. */
function liveRate(key, s) {
  const base = NOMINAL_RATES[key] ?? 1;
  if (key === 'Dracos') return base * (s?.goldMod  ?? 1);
  if (key === 'Jools')  return base * (s?.joolPegMod ?? 1) * (s?.goldMod ?? 1);
  if (key === 'Glint')  return base * (s?.goldMod  ?? 1);
  if (key === 'Flux')   return base * (s?.goldMod  ?? 1);
  if (key === 'Ash')    return base * (s?.ashShadow ?? 1);
  return base; // OStar, unknown
}

/** Bid/ask spread arithmetic — identical to prototype. */
function bidPrice(c)    { return c.price * (1 - c.spreadPct / 200); }
function askPrice(c)    { return c.price * (1 + c.spreadPct / 200); }
function usdValue(price, currency, s) { return price * liveRate(currency, s); }
function usdBid(c, s)   { return usdValue(bidPrice(c), c.currency, s); }
function usdAsk(c, s)   { return usdValue(askPrice(c), c.currency, s); }
function marketCapUsd(c, s) { return usdValue(c.price, c.currency, s) * c.shares; }

// ─────────────────────────────────────────────
//  Company master list  (56 companies, 7 sections)
// ─────────────────────────────────────────────
const RAW_COMPANIES = [
  // ── Continental Board ──
  { ticker:'ACIB', name:'Argos Continental Investment Bank', section:'Continental Board', sector:'Finance', region:'Argos', currency:'Dracos', price:6200, shares:4_200_000, vol:0.008, spreadPct:0.25, dividendYield:0.028, desc:'The premier investment bank of the continent' },
  { ticker:'AHC',  name:'Argos Holdings Corporation',        section:'Continental Board', sector:'Conglomerate', region:'Argos', currency:'Dracos', price:9800, shares:2_800_000, vol:0.010, spreadPct:0.20, dividendYield:0.022, desc:'The dominant multi-sector holding company of Argos' },
  { ticker:'AIMX', name:'Argos Intermodal Exchange',         section:'Continental Board', sector:'Logistics', region:'Argos', currency:'Dracos', price:3100, shares:3_600_000, vol:0.012, spreadPct:0.30, dividendYield:0.018, desc:'Largest freight and intermodal hub on the continent' },
  { ticker:'AICE', name:'AICE Composite Index Fund',         section:'Continental Board', sector:'Index', region:'Pan-Continental', currency:'OStar', price:1000, shares:10_000_000, vol:0.006, spreadPct:0.15, dividendYield:0.012, desc:'Tracks the AICE composite — broad continental exposure' },
  { ticker:'DCE',  name:'Deveraux Continental Enterprises',  section:'Continental Board', sector:'Conglomerate', region:'Argos', currency:'Dracos', price:14500, shares:1_800_000, vol:0.009, spreadPct:0.18, dividendYield:0.030, desc:'Deveraux family flagship — diversified across industries' },
  { ticker:'IGXB', name:'Igoine Exchange Bank',              section:'Continental Board', sector:'Finance', region:'Igoine', currency:'Jools', price:480000, shares:900_000, vol:0.011, spreadPct:0.28, dividendYield:0.024, desc:'Igoine\'s central private banking institution' },
  { ticker:'PAXF', name:'Pax Financial Group',               section:'Continental Board', sector:'Finance', region:'Pan-Continental', currency:'OStar', price:3800, shares:5_000_000, vol:0.009, spreadPct:0.22, dividendYield:0.026, desc:'Cross-border financial services and insurance' },
  { ticker:'FENX', name:'Fenrir Exchange Consortium',        section:'Continental Board', sector:'Commodities', region:'Argos North', currency:'Dracos', price:7700, shares:2_200_000, vol:0.014, spreadPct:0.35, dividendYield:0.015, desc:'Rare materials brokerage operating out of Fenrir' },

  // ── Skyways ──
  { ticker:'ASA',  name:'Argos Skyways Authority',     section:'Skyways', sector:'Aviation', region:'Argos', currency:'Dracos', price:2600, shares:6_000_000, vol:0.013, spreadPct:0.40, dividendYield:0.010, desc:'Government-chartered flag carrier and airspace manager' },
  { ticker:'VLTX', name:'Voltaire Express',             section:'Skyways', sector:'Aviation', region:'Pan-Continental', currency:'OStar', price:880, shares:8_000_000, vol:0.018, spreadPct:0.50, dividendYield:0.008, desc:'Budget intercontinental airline' },
  { ticker:'SKYW', name:'Skywatch Navigation Co.',      section:'Skyways', sector:'Aviation', region:'Argos', currency:'Dracos', price:1450, shares:4_500_000, vol:0.016, spreadPct:0.45, dividendYield:0.006, desc:'Air traffic management and flight routing services' },
  { ticker:'AERO', name:'Aero Manufacturing Guild',     section:'Skyways', sector:'Manufacturing', region:'Argos', currency:'Dracos', price:5300, shares:3_100_000, vol:0.012, spreadPct:0.35, dividendYield:0.014, desc:'Aircraft and airframe construction' },
  { ticker:'CLOUD',name:'Cloudborne Cargo Ltd.',        section:'Skyways', sector:'Logistics', region:'Pan-Continental', currency:'OStar', price:620, shares:7_000_000, vol:0.020, spreadPct:0.55, dividendYield:0.005, desc:'Air freight and express cargo services' },
  { ticker:'JETZ', name:'Jetzeal Charter Services',     section:'Skyways', sector:'Aviation', region:'Igoine', currency:'Jools', price:72000, shares:1_200_000, vol:0.022, spreadPct:0.60, dividendYield:0.004, desc:'Private jet charter for Igoine elite clientele' },

  // ── Igoine Elite ──
  { ticker:'AUX',  name:'Aurex Luxury Group',           section:'Igoine Elite', sector:'Luxury', region:'Igoine', currency:'Jools', price:1_800_000, shares:450_000, vol:0.007, spreadPct:0.20, dividendYield:0.035, desc:'Bespoke fashion, jewellery, and high couture' },
  { ticker:'CRVT', name:'Corvette & Thorne Estates',    section:'Igoine Elite', sector:'Real Estate', region:'Igoine', currency:'Jools', price:2_400_000, shares:300_000, vol:0.006, spreadPct:0.18, dividendYield:0.040, desc:'Prestige property development and management' },
  { ticker:'OPLS', name:'Opalis Fine Dining Corp.',     section:'Igoine Elite', sector:'Hospitality', region:'Igoine', currency:'Jools', price:540_000, shares:800_000, vol:0.010, spreadPct:0.25, dividendYield:0.028, desc:'Chain of Michelin-calibre restaurants' },
  { ticker:'VRDN', name:'Veridon Private Wealth',       section:'Igoine Elite', sector:'Finance', region:'Igoine', currency:'Jools', price:3_200_000, shares:200_000, vol:0.005, spreadPct:0.15, dividendYield:0.045, desc:'Ultra-high-net-worth wealth management' },
  { ticker:'MRVX', name:'Marvex Auction House',         section:'Igoine Elite', sector:'Luxury', region:'Igoine', currency:'Jools', price:920_000, shares:600_000, vol:0.009, spreadPct:0.22, dividendYield:0.020, desc:'Premier auction house for art, antiques, and collectables' },
  { ticker:'PRSM', name:'Prism Media & Culture',        section:'Igoine Elite', sector:'Media', region:'Igoine', currency:'Jools', price:680_000, shares:700_000, vol:0.012, spreadPct:0.30, dividendYield:0.016, desc:'Luxury entertainment: theatre, opera, broadcast' },
  { ticker:'STNX', name:'Stenox Pharmaceutical',        section:'Igoine Elite', sector:'Healthcare', region:'Igoine', currency:'Jools', price:1_100_000, shares:500_000, vol:0.011, spreadPct:0.28, dividendYield:0.022, desc:'Premium biopharmaceuticals for elite healthcare networks' },
  { ticker:'IGTX', name:'Igoine Trade & Transport',     section:'Igoine Elite', sector:'Logistics', region:'Igoine', currency:'Jools', price:750_000, shares:650_000, vol:0.009, spreadPct:0.25, dividendYield:0.026, desc:'Igoine\'s dominant shipping conglomerate' },

  // ── Igoine Consumer ──
  { ticker:'BYRD', name:'Byrd Consumer Goods',          section:'Igoine Consumer', sector:'Consumer', region:'Igoine', currency:'Jools', price:38_000, shares:5_000_000, vol:0.015, spreadPct:0.40, dividendYield:0.012, desc:'Household products, personal care, mass-market retail' },
  { ticker:'FLMX', name:'Flamex Foods & Beverages',     section:'Igoine Consumer', sector:'Consumer', region:'Igoine', currency:'Jools', price:22_000, shares:7_000_000, vol:0.014, spreadPct:0.38, dividendYield:0.014, desc:'The largest food conglomerate in Igoine' },
  { ticker:'MRKT', name:'Marketade Retail Group',       section:'Igoine Consumer', sector:'Retail', region:'Igoine', currency:'Jools', price:15_000, shares:9_000_000, vol:0.018, spreadPct:0.45, dividendYield:0.010, desc:'Supermarket and discount retail chain' },
  { ticker:'TLCM', name:'Telecom Igoine',               section:'Igoine Consumer', sector:'Telecom', region:'Igoine', currency:'Jools', price:55_000, shares:4_000_000, vol:0.011, spreadPct:0.32, dividendYield:0.018, desc:'State-adjacent mobile and broadband provider' },
  { ticker:'IGME', name:'Igoine Media Entertainment',   section:'Igoine Consumer', sector:'Media', region:'Igoine', currency:'Jools', price:28_000, shares:6_000_000, vol:0.016, spreadPct:0.42, dividendYield:0.011, desc:'Popular broadcast, streaming, and print group' },
  { ticker:'HPHR', name:'Hophar Pharmaceuticals',       section:'Igoine Consumer', sector:'Healthcare', region:'Igoine', currency:'Jools', price:44_000, shares:4_500_000, vol:0.013, spreadPct:0.36, dividendYield:0.016, desc:'Generic medicines and OTC health products' },
  { ticker:'LVST', name:'Livestock & Grain Igoine',     section:'Igoine Consumer', sector:'Agriculture', region:'Igoine', currency:'Jools', price:18_000, shares:8_000_000, vol:0.020, spreadPct:0.50, dividendYield:0.009, desc:'Commodity agriculture and food supply chain' },
  { ticker:'CNSX', name:'Construct Igoine',             section:'Igoine Consumer', sector:'Construction', region:'Igoine', currency:'Jools', price:32_000, shares:5_500_000, vol:0.017, spreadPct:0.44, dividendYield:0.013, desc:'Mass-housing and infrastructure construction' },

  // ── Drone (tech / automation) ──
  { ticker:'DRVX', name:'Drivex Autonomous Systems',    section:'Drone', sector:'Technology', region:'Argos', currency:'OStar', price:420, shares:12_000_000, vol:0.028, spreadPct:0.70, dividendYield:0.000, desc:'Self-driving vehicles and logistics automation' },
  { ticker:'NXGN', name:'Nexgen Computing',             section:'Drone', sector:'Technology', region:'Argos', currency:'OStar', price:680, shares:10_000_000, vol:0.026, spreadPct:0.65, dividendYield:0.000, desc:'AI compute infrastructure and chip design' },
  { ticker:'SYNK', name:'Synkron Data Services',        section:'Drone', sector:'Technology', region:'Pan-Continental', currency:'OStar', price:310, shares:14_000_000, vol:0.030, spreadPct:0.75, dividendYield:0.000, desc:'Cloud data and real-time analytics platform' },
  { ticker:'PROT', name:'Protean Robotics',             section:'Drone', sector:'Manufacturing', region:'Argos', currency:'OStar', price:550, shares:9_000_000, vol:0.032, spreadPct:0.80, dividendYield:0.000, desc:'Industrial and consumer robotic systems' },
  { ticker:'HELIX',name:'Helix Biotech',                section:'Drone', sector:'Biotech', region:'Argos', currency:'OStar', price:890, shares:6_000_000, vol:0.035, spreadPct:0.90, dividendYield:0.000, desc:'Gene editing and precision medicine R&D' },
  { ticker:'FLUX', name:'Flux Energy Technologies',     section:'Drone', sector:'Energy', region:'Argos', currency:'OStar', price:240, shares:18_000_000, vol:0.034, spreadPct:0.85, dividendYield:0.002, desc:'Next-gen battery and clean power systems' },
  { ticker:'VRTA', name:'Verta Communications',         section:'Drone', sector:'Telecom', region:'Pan-Continental', currency:'OStar', price:180, shares:20_000_000, vol:0.025, spreadPct:0.60, dividendYield:0.005, desc:'Satellite and mesh communications infrastructure' },
  { ticker:'KLNX', name:'Kalix Neural Networks',        section:'Drone', sector:'Technology', region:'Argos', currency:'OStar', price:1200, shares:4_000_000, vol:0.040, spreadPct:1.00, dividendYield:0.000, desc:'LLM and AI-agent development firm' },
  { ticker:'STKX', name:'Stackex Data Exchange',        section:'Drone', sector:'Technology', region:'Argos', currency:'OStar', price:290, shares:11_000_000, vol:0.029, spreadPct:0.72, dividendYield:0.000, desc:'Peer-to-peer data marketplace and API broker' },

  // ── Wider Continent ──
  { ticker:'FNRX', name:'Fenrir Resources',             section:'Wider Continent', sector:'Mining', region:'Argos North', currency:'Dracos', price:1800, shares:8_000_000, vol:0.018, spreadPct:0.48, dividendYield:0.020, desc:'Rare earth and mineral extraction from the northern range' },
  { ticker:'WTRL', name:'Waterline Shipping Co.',       section:'Wider Continent', sector:'Shipping', region:'Pan-Continental', currency:'OStar', price:560, shares:9_000_000, vol:0.016, spreadPct:0.42, dividendYield:0.018, desc:'Continental freight and passenger shipping' },
  { ticker:'AGRC', name:'Agrocell Farming Coop',        section:'Wider Continent', sector:'Agriculture', region:'Argos', currency:'Dracos', price:720, shares:11_000_000, vol:0.020, spreadPct:0.50, dividendYield:0.015, desc:'Cooperative farming and grain futures' },
  { ticker:'SRCL', name:'Suracle Energy',               section:'Wider Continent', sector:'Energy', region:'Pan-Continental', currency:'OStar', price:380, shares:13_000_000, vol:0.022, spreadPct:0.55, dividendYield:0.016, desc:'Conventional and renewable energy generation' },
  { ticker:'LVRX', name:'Leviathan Records',            section:'Wider Continent', sector:'Entertainment', region:'Argos', currency:'OStar', price:140, shares:16_000_000, vol:0.030, spreadPct:0.80, dividendYield:0.005, desc:'Dominant music label and streaming platform' },
  { ticker:'NWSP', name:'Newspaper Consortium',         section:'Wider Continent', sector:'Media', region:'Pan-Continental', currency:'OStar', price:95, shares:14_000_000, vol:0.025, spreadPct:0.70, dividendYield:0.008, desc:'The continent\'s oldest and broadest print media group' },
  { ticker:'MCHT', name:'Mercha Trade Alliance',        section:'Wider Continent', sector:'Retail', region:'Pan-Continental', currency:'OStar', price:210, shares:12_000_000, vol:0.018, spreadPct:0.46, dividendYield:0.012, desc:'Cross-border merchant cooperative and trade finance' },
  { ticker:'INSX', name:'Insura Continental',           section:'Wider Continent', sector:'Insurance', region:'Argos', currency:'Dracos', price:2400, shares:5_000_000, vol:0.012, spreadPct:0.32, dividendYield:0.025, desc:'Multi-line insurance: life, property, casualty' },
  { ticker:'ACDX', name:'Academy Institutes Ltd.',      section:'Wider Continent', sector:'Education', region:'Pan-Continental', currency:'OStar', price:320, shares:7_000_000, vol:0.014, spreadPct:0.38, dividendYield:0.010, desc:'Higher education and professional training network' },
  { ticker:'LOCX', name:'Locations Property Trust',     section:'Wider Continent', sector:'Real Estate', region:'Pan-Continental', currency:'OStar', price:480, shares:9_000_000, vol:0.013, spreadPct:0.36, dividendYield:0.030, desc:'Diversified real-estate investment trust' },
  { ticker:'PRFL', name:'Profile Data Analytics',       section:'Wider Continent', sector:'Technology', region:'Argos', currency:'OStar', price:265, shares:10_000_000, vol:0.022, spreadPct:0.58, dividendYield:0.000, desc:'Consumer behaviour analytics and market intelligence' },
  { ticker:'SHPX', name:'Shopline Commerce',            section:'Wider Continent', sector:'Retail', region:'Igoine', currency:'Jools', price:25_000, shares:8_000_000, vol:0.019, spreadPct:0.50, dividendYield:0.007, desc:'Igoine e-commerce and last-mile delivery' },
  { ticker:'SGNX', name:'Signup Financial Tech',        section:'Wider Continent', sector:'Fintech', region:'Pan-Continental', currency:'OStar', price:190, shares:15_000_000, vol:0.027, spreadPct:0.68, dividendYield:0.000, desc:'Digital payments, lending, and wallet infrastructure' },
  { ticker:'ARGX', name:'Argos General Exports',        section:'Wider Continent', sector:'Commodities', region:'Argos', currency:'Dracos', price:3400, shares:4_000_000, vol:0.014, spreadPct:0.36, dividendYield:0.022, desc:'Bulk commodity export agency for the Argos federation' },
  { ticker:'IGNS', name:'Igoine National Shipping',     section:'Wider Continent', sector:'Shipping', region:'Igoine', currency:'Jools', price:62_000, shares:3_500_000, vol:0.016, spreadPct:0.42, dividendYield:0.019, desc:'State-linked cargo and tanker fleet' },
];

// Free tier: 5 Dracos (stored internally as USD equivalent)
// 1 Draco = 1 kg gold = GOLD_KG_USD. Paid tier is granted O$50,000 via Stripe.
const STARTING_CASH = 5 * GOLD_KG_USD; // ≈ 665,654 USD (5 Dracos)

/** Assign simulation parameters and build the initial state object. */
function buildInitialState() {
  const now = Date.now();
  const companies = RAW_COMPANIES.map(r => ({
    ...r,
    openingPrice:   r.price,
    changePct:      0,
    history:        [r.price],
    dividendYieldPct: (r.dividendYield * 100),
    driftBias:      0,
    driftTicksLeft: 0,
    delisted:       false,
  }));

  return {
    companies,
    tickCount:    0,
    indexValue:   1000,
    indexHistory: [1000],
    goldMod:      1.0,
    joolPegMod:   1.0,
    starMod:      1.0,
    ashShadow:    1.0,
    events:       [],
    delistings:   [],
    lastRealMs:   now,
  };
}

// ─────────────────────────────────────────────
//  Sector correlation table
// ─────────────────────────────────────────────
const SECTOR_GROUPS = {
  Finance:       ['ACIB','IGXB','PAXF','VERIDON','VRDN','SGNX'],
  Technology:    ['DRVX','NXGN','SYNK','PROT','KLNX','STKX','PRFL'],
  Aviation:      ['ASA','VLTX','SKYW','JETZ'],
  Luxury:        ['AUX','MRVX','OPLS'],
  Consumer:      ['BYRD','FLMX','MRKT','LVST'],
  Energy:        ['SRCL','FLUX'],
  Mining:        ['FNRX','ARGX','FENX'],
  Shipping:      ['WTRL','IGNS','AIMX','IGTX','CLOUD'],
  Media:         ['PRSM','IGME','NWSP','LVRX'],
  Healthcare:    ['STNX','HPHR','HELIX'],
  Agriculture:   ['AGRC','LVST'],
  RealEstate:    ['CRVT','LOCX','CNSX'],
};

function getSectorPeers(ticker) {
  for (const peers of Object.values(SECTOR_GROUPS)) {
    if (peers.includes(ticker)) return peers;
  }
  return [];
}

// ─────────────────────────────────────────────
//  Tick engine  (AR(1) + sector correlation + mean reversion)
// ─────────────────────────────────────────────

/** Standard normal via Box-Muller. */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function advanceTick(s) {
  s.tickCount++;

  // Ash shadow random walk
  s.ashShadow *= (1 + randn() * 0.008);
  s.ashShadow  = Math.max(0.7, Math.min(1.4, s.ashShadow));

  // Sector correlation noise
  const sectorShock = {};
  for (const key of Object.keys(SECTOR_GROUPS)) {
    sectorShock[key] = randn() * 0.003;
  }

  s.companies.forEach(c => {
    if (c.delisted) return;

    // AR(1) idiosyncratic + sector shock
    const idio = randn() * c.vol;
    let shock = idio;
    const peers = getSectorPeers(c.ticker);
    for (const [key, members] of Object.entries(SECTOR_GROUPS)) {
      if (members.includes(c.ticker)) shock += sectorShock[key];
    }

    // Mean reversion toward opening price
    const meanReversion = (c.openingPrice - c.price) / c.openingPrice * 0.02;

    // Event-driven drift bias
    let drift = 0;
    if (c.driftTicksLeft > 0) {
      drift = c.driftBias / 100;
      c.driftTicksLeft--;
      if (c.driftTicksLeft === 0) c.driftBias = 0;
    }

    const pctChange = shock + meanReversion + drift;
    const oldPrice  = c.price;
    c.price = Math.max(c.price * (1 + pctChange), 0.01);
    c.changePct = ((c.price - oldPrice) / oldPrice) * 100;

    c.history.push(c.price);
    if (c.history.length > 24) c.history.shift();

    // Delist if price falls below 8% of opening
    if (c.price < c.openingPrice * 0.08 && !c.delisted) {
      c.delisted = true;
      c.price    = c.openingPrice * 0.08;
      s.delistings = s.delistings || [];
      s.delistings.push({ ticker: c.ticker, tick: s.tickCount });
    }
  });

  updateIndex(s);
  s.lastRealMs = Date.now();
}

/** Recompute AICE composite index (market-cap weighted, 1000 base). */
function updateIndex(s) {
  const active = s.companies.filter(c => !c.delisted);
  if (!active.length) return;
  const totalCap = active.reduce((sum, c) => sum + marketCapUsd(c, s), 0);
  const baseCap  = active.reduce((sum, c) => sum + usdValue(c.openingPrice, c.currency, s) * c.shares, 0);
  s.indexValue = baseCap > 0 ? (totalCap / baseCap) * 1000 : 1000;
  s.indexHistory.push(s.indexValue);
  if (s.indexHistory.length > 60) s.indexHistory.shift();
}

// ─────────────────────────────────────────────
//  Account maintenance  (dividends, delistings, limit orders)
//  Called from the scheduler after every tick; receives the DB client.
// ─────────────────────────────────────────────
async function runAccountMaintenance(s, db) {
  if (s.tickCount % 20 !== 0) return; // dividends every 20 ticks

  const { rows: accounts } = await db.query('SELECT id, cash_usd, currency FROM accounts');
  for (const acc of accounts) {
    // ── Dividends ──
    const { rows: holdings } = await db.query(
      'SELECT ticker, shares FROM holdings WHERE account_id = $1 AND shares > 0',
      [acc.id]
    );
    let dividendTotal = 0;
    for (const h of holdings) {
      const c = s.companies.find(x => x.ticker === h.ticker);
      if (!c || c.delisted || !(c.dividendYield > 0)) continue;
      const divPerShare = usdValue(c.price, c.currency, s) * (c.dividendYield / 20);
      dividendTotal += divPerShare * h.shares;
    }
    if (dividendTotal > 0) {
      await db.query('UPDATE accounts SET cash_usd = cash_usd + $1 WHERE id = $2', [dividendTotal, acc.id]);
      await db.query(
        `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd, settle_currency)
         VALUES ($1, 'dividend', 'DIVIDEND', 0, 0, $2, $3)`,
        [acc.id, dividendTotal, acc.currency]
      );
    }

    // ── Delist payouts ──
    const newDelistings = (s.delistings || []).filter(d => !d.paid);
    for (const dl of newDelistings) {
      const { rows: hRows } = await db.query(
        'SELECT shares FROM holdings WHERE account_id = $1 AND ticker = $2',
        [acc.id, dl.ticker]
      );
      if (hRows.length && hRows[0].shares > 0) {
        const c = s.companies.find(x => x.ticker === dl.ticker);
        if (!c) continue;
        const payout = usdValue(c.price, c.currency, s) * hRows[0].shares;
        await db.query('UPDATE accounts SET cash_usd = cash_usd + $1 WHERE id = $2', [payout, acc.id]);
        await db.query('UPDATE holdings SET shares = 0 WHERE account_id = $1 AND ticker = $2', [acc.id, dl.ticker]);
        await db.query(
          `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd, settle_currency)
           VALUES ($1, 'delist', $2, $3, $4, $5, $6)`,
          [acc.id, dl.ticker, hRows[0].shares, usdValue(c.price, c.currency, s), payout, acc.currency]
        );
      }
    }

    // ── Limit order fills ──
    const { rows: orders } = await db.query(
      'SELECT * FROM pending_orders WHERE account_id = $1',
      [acc.id]
    );
    const { rows: [freshAcc] } = await db.query('SELECT cash_usd FROM accounts WHERE id = $1', [acc.id]);
    let currentCash = freshAcc.cash_usd;

    for (const ord of orders) {
      const c = s.companies.find(x => x.ticker === ord.ticker);
      if (!c || c.delisted) {
        await db.query('DELETE FROM pending_orders WHERE id = $1', [ord.id]);
        continue;
      }

      let filled = false;
      if (ord.action === 'buy' && usdAsk(c, s) <= ord.limit_usd) {
        const cost = usdAsk(c, s) * ord.qty;
        if (cost <= currentCash) {
          currentCash -= cost;
          await db.query('UPDATE accounts SET cash_usd = cash_usd - $1 WHERE id = $2', [cost, acc.id]);
          await db.query(
            `INSERT INTO holdings (account_id, ticker, shares, avg_cost_usd)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (account_id, ticker) DO UPDATE
               SET avg_cost_usd = (holdings.avg_cost_usd * holdings.shares + $4 * $3) / (holdings.shares + $3),
                   shares = holdings.shares + $3`,
            [acc.id, ord.ticker, ord.qty, usdAsk(c, s)]
          );
          await db.query(
            `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd, settle_currency)
             VALUES ($1, 'buy', $2, $3, $4, $5, $6)`,
            [acc.id, ord.ticker, ord.qty, usdAsk(c, s), cost, acc.currency]
          );
          filled = true;
        }
      } else if (ord.action === 'sell' && usdBid(c, s) >= ord.limit_usd) {
        const { rows: hRows } = await db.query(
          'SELECT shares FROM holdings WHERE account_id = $1 AND ticker = $2',
          [acc.id, ord.ticker]
        );
        if (hRows.length && hRows[0].shares >= ord.qty) {
          const proceeds = usdBid(c, s) * ord.qty;
          await db.query('UPDATE accounts SET cash_usd = cash_usd + $1 WHERE id = $2', [proceeds, acc.id]);
          await db.query(
            'UPDATE holdings SET shares = shares - $1 WHERE account_id = $2 AND ticker = $3',
            [ord.qty, acc.id, ord.ticker]
          );
          await db.query(
            `INSERT INTO transactions (account_id, action, ticker, qty, price_usd, total_usd, settle_currency)
             VALUES ($1, 'sell', $2, $3, $4, $5, $6)`,
            [acc.id, ord.ticker, ord.qty, usdBid(c, s), proceeds, acc.currency]
          );
          filled = true;
        }
      }

      if (filled) {
        await db.query('DELETE FROM pending_orders WHERE id = $1', [ord.id]);
      }
    }
  }

  // Mark new delistings as paid so they don't double-pay
  if (s.delistings) {
    s.delistings.forEach(d => { d.paid = true; });
  }
}

// ─────────────────────────────────────────────
//  Market hours
// ─────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;
  const h = now.getHours(), m = now.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function nextOpenLabel() {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours(), m = now.getMinutes();
  const mins = h * 60 + m;
  if (day >= 1 && day <= 5 && mins < 9 * 60 + 30) return 'today at 9:30am';
  const daysUntilMon = (8 - day) % 7 || 7;
  return day === 5 || day === 6
    ? `Monday at 9:30am (${daysUntilMon} day${daysUntilMon > 1 ? 's' : ''})`
    : 'tomorrow at 9:30am';
}

module.exports = {
  STARTING_CASH,
  NOMINAL_RATES,
  liveRate,
  bidPrice,
  askPrice,
  usdValue,
  usdBid,
  usdAsk,
  marketCapUsd,
  buildInitialState,
  advanceTick,
  updateIndex,
  runAccountMaintenance,
  isMarketOpen,
  nextOpenLabel,
};
