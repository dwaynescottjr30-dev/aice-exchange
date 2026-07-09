'use strict';

/**
 * scheduler.js — cron-driven tick loop
 *
 * Advances one market tick every TICK_SECONDS when the market is open.
 * The cron job itself always fires (every N seconds) but the tick only
 * executes when isMarketOpen() is true, mirroring the browser prototype.
 *
 * TICK_SECONDS is read from process.env.TICK_SECONDS (default 30).
 */

const cron = require('node-cron');
const { advanceTick, runAccountMaintenance, isMarketOpen } = require('./market');
const { getState, saveState } = require('./stateStore');
const db = require('./db');

let _cronJob = null;
let _ticking  = false;

async function doTick() {
  if (_ticking) return;           // prevent overlap
  _ticking = true;
  try {
    if (!isMarketOpen()) return;  // only trade during market hours
    const s = getState();
    if (!s) return;

    advanceTick(s);
    await runAccountMaintenance(s, db);
    await saveState();

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[tick] #${s.tickCount}  AICE=${s.indexValue.toFixed(2)}`);
    }
  } catch (err) {
    console.error('[tick] error:', err.message);
  } finally {
    _ticking = false;
  }
}

function buildCronExpression(seconds) {
  // node-cron supports */N second syntax
  return `*/${seconds} * * * * *`;
}

function start() {
  const seconds = Math.max(5, parseInt(process.env.TICK_SECONDS ?? '30', 10));
  const expr    = buildCronExpression(seconds);
  console.log(`[scheduler] tick every ${seconds}s  cron="${expr}"`);
  _cronJob = cron.schedule(expr, doTick, { scheduled: true });
}

function stop() {
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
}

module.exports = { start, stop, doTick };
