// Slows down password guessing against the admin login.
//
// In-memory and per-process, which is the right size for one operator on one
// Railway instance: a restart clears it, and there is nothing to keep in sync.

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const PRUNE_AFTER_MS = 60 * 60 * 1000;

function createLoginThrottle(options = {}) {
  const maxAttempts = options.maxAttempts || MAX_ATTEMPTS;
  const windowMs = options.windowMs || WINDOW_MS;
  const attempts = new Map(); // key → { count, firstAt }

  function prune(now) {
    for (const [key, record] of attempts) {
      if (now - record.firstAt > PRUNE_AFTER_MS) attempts.delete(key);
    }
  }

  function currentRecord(key, now) {
    const record = attempts.get(key);
    if (!record || now - record.firstAt > windowMs) return null;
    return record;
  }

  function check(key, now = Date.now()) {
    const record = currentRecord(key, now);
    if (!record || record.count < maxAttempts) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: windowMs - (now - record.firstAt) };
  }

  function recordFailure(key, now = Date.now()) {
    prune(now);
    const record = currentRecord(key, now);
    // Replace the record rather than mutating it.
    attempts.set(key, record
      ? { count: record.count + 1, firstAt: record.firstAt }
      : { count: 1, firstAt: now });
  }

  function reset(key) {
    attempts.delete(key);
  }

  return { check, recordFailure, reset };
}

module.exports = { createLoginThrottle, MAX_ATTEMPTS, WINDOW_MS };
