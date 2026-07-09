'use strict';

/**
 * stateStore.js — in-memory market state with PostgreSQL persistence
 *
 * The tick engine operates entirely on a JS object in memory so ticks are
 * fast (no DB round-trip per company per tick).  After every tick the
 * full state is written back to the `market_state` table as a single JSON
 * blob.  On startup the server loads from the DB, so state survives restarts.
 */

const db = require('./db');
const { buildInitialState } = require('./market');

let _state = null;

async function loadState() {
  try {
    const { rows } = await db.query('SELECT state_json FROM market_state WHERE id = 1');
    if (rows.length && rows[0].state_json) {
      _state = rows[0].state_json;
      console.log(`[state] loaded from DB — tick ${_state.tickCount}`);
    } else {
      _state = buildInitialState();
      await saveState();
      console.log('[state] initialised fresh market state');
    }
  } catch (err) {
    console.error('[state] failed to load from DB, using fresh state:', err.message);
    _state = buildInitialState();
  }
  return _state;
}

async function saveState() {
  await db.query(
    `INSERT INTO market_state (id, state_json, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET state_json = $1, updated_at = NOW()`,
    [JSON.stringify(_state)]
  );
}

function getState() {
  return _state;
}

function setState(s) {
  _state = s;
}

module.exports = { loadState, saveState, getState, setState };
