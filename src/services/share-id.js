// Public, unguessable identifier for a single assessment result.
// The numeric row id is never exposed in a shareable URL — it is enumerable,
// which would let anyone walk the table by incrementing a number.

const crypto = require("crypto");

const SHARE_ID_BYTES = 9; // 72 bits of entropy → 12 base64url characters
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_COLLISION_RETRIES = 5;

function generateShareId() {
  return crypto.randomBytes(SHARE_ID_BYTES).toString("base64url");
}

function isValidShareId(value) {
  return typeof value === "string" && SHARE_ID_PATTERN.test(value);
}

// Generates an id that is not already taken. `isTaken` is a predicate so this
// stays independent of the database layer.
function createUniqueShareId(isTaken) {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const candidate = generateShareId();
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique share id after " + MAX_COLLISION_RETRIES + " attempts.");
}

module.exports = {
  generateShareId,
  isValidShareId,
  createUniqueShareId,
  SHARE_ID_PATTERN,
};
