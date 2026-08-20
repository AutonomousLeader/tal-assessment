// Password gate for the admin console.
//
// One operator, one password, held in the ADMIN_PASSWORD environment variable.
// A successful login issues a signed, expiring token in an httpOnly cookie, so
// the browser cannot read it and a stolen token dies on its own.

const crypto = require("crypto");

const COOKIE_NAME = "tal_admin_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Sessions are signed with this. Set ADMIN_SESSION_SECRET to keep people signed
// in across restarts; without it a fresh secret is generated per boot, which
// simply means everyone signs in again after a deploy.
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");

function isAdminEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function verifyPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string" || candidate.length === 0) return false;

  // Hash both sides first so the comparison is constant length, then constant time.
  const candidateHash = crypto.createHash("sha256").update(candidate).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function sign(encodedPayload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
}

function createSessionToken(now = Date.now()) {
  const payload = {
    exp: now + SESSION_TTL_MS,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + sign(encoded);
}

function verifySessionToken(token, now = Date.now()) {
  if (typeof token !== "string") return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encoded, signature] = parts;
  const expected = sign(encoded);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > now;
  } catch (err) {
    return false;
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return {};

  return cookieHeader.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 1) return cookies;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    return { ...cookies, [name]: decodeURIComponent(value) };
  }, {});
}

function isAuthenticatedRequest(req, now = Date.now()) {
  if (!isAdminEnabled()) return false;
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME], now);
}

// Railway terminates TLS in front of the app, so the request itself arrives
// over http. The forwarded header is what says how the browser connected.
function isSecureRequest(req) {
  if (process.env.NODE_ENV === "production") return true;
  if (req && req.secure) return true;
  const forwardedProto = req && req.headers ? req.headers["x-forwarded-proto"] : null;
  return typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https";
}

function buildSessionCookie(token, req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function buildClearedCookie(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  isAdminEnabled,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  isAuthenticatedRequest,
  isSecureRequest,
  buildSessionCookie,
  buildClearedCookie,
};
