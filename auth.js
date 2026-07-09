'use strict';

/**
 * auth.js — session token helpers
 *
 * We use a simple in-process token map so the server doesn't need Redis
 * for a single-node deployment.  Replace with a DB-backed session or JWT
 * if you scale to multiple nodes later.
 */

const crypto = require('crypto');

// token → { accountId, name, currency, expiresAt }
const sessions = new Map();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession(accountId, name, currency) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    accountId,
    name,
    currency,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function deleteSession(token) {
  sessions.delete(token);
}

/** Express middleware — attaches req.session if the Authorization header
 *  carries a valid Bearer token.  Does NOT reject unauthenticated requests;
 *  individual routes enforce that themselves. */
function sessionMiddleware(req, _res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  req.session = getSession(token);
  req.token   = token;
  next();
}

/** Middleware that rejects requests with no valid session. */
function requireAuth(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'Not authenticated — log in first.' });
  }
  next();
}

module.exports = { createSession, getSession, deleteSession, sessionMiddleware, requireAuth };
