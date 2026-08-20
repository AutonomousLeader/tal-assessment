// Admin console API: sign in, list every assessment, open one in full.
//
// Everything below /assessments requires a valid session cookie. These
// responses carry real contact details, so there is no anonymous read path.

const express = require("express");
const {
  isAdminEnabled,
  verifyPassword,
  createSessionToken,
  isAuthenticatedRequest,
  buildSessionCookie,
  buildClearedCookie,
} = require("../services/admin-auth");
const { createLoginThrottle } = require("../services/login-throttle");
const { toAdminResult, toAdminListItem } = require("../services/admin-result");
const { importFromKit } = require("../services/kit-import");
const { createUniqueShareId } = require("../services/share-id");

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 120;

function parsePaging(query) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);

  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const offset = Number.isInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;

  const search = typeof query.search === "string"
    ? query.search.trim().slice(0, MAX_SEARCH_LENGTH)
    : "";

  return { limit, offset, search };
}

function createAdminRoutes(repo) {
  const router = express.Router();
  const throttle = createLoginThrottle();

  function requireAdmin(req, res, next) {
    if (!isAdminEnabled()) {
      return res.status(503).json({ success: false, errors: ["Admin access is not configured on this server."] });
    }
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ success: false, errors: ["Please sign in."] });
    }
    return next();
  }

  // GET /api/admin/session — what the sign-in screen needs to know.
  router.get("/session", (req, res) => {
    res.json({
      success: true,
      data: {
        adminEnabled: isAdminEnabled(),
        authenticated: isAuthenticatedRequest(req),
      },
    });
  });

  // POST /api/admin/login
  router.post("/login", (req, res) => {
    if (!isAdminEnabled()) {
      return res.status(503).json({ success: false, errors: ["Admin access is not configured on this server."] });
    }

    const key = req.ip || "unknown";
    const gate = throttle.check(key);
    if (!gate.allowed) {
      const minutes = Math.max(1, Math.ceil(gate.retryAfterMs / 60000));
      return res.status(429).json({
        success: false,
        errors: [`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`],
      });
    }

    if (!verifyPassword(req.body && req.body.password)) {
      throttle.recordFailure(key);
      return res.status(401).json({ success: false, errors: ["That password is not right."] });
    }

    throttle.reset(key);
    res.setHeader("Set-Cookie", buildSessionCookie(createSessionToken(), req));
    res.json({ success: true, data: { authenticated: true } });
  });

  // POST /api/admin/logout
  router.post("/logout", (req, res) => {
    res.setHeader("Set-Cookie", buildClearedCookie(req));
    res.json({ success: true, data: { authenticated: false } });
  });

  // GET /api/admin/assessments — newest first, searchable by name or email.
  router.get("/assessments", requireAdmin, (req, res) => {
    const { limit, offset, search } = parsePaging(req.query);

    const rows = repo.listAssessments({ search, limit, offset });
    const total = repo.countAssessments({ search });

    res.json({
      success: true,
      data: {
        items: rows.map(toAdminListItem),
        total,
        limit,
        offset,
        search,
      },
    });
  });

  // GET /api/admin/assessments/:id — the full result, as the taker saw it.
  router.get("/assessments/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, errors: ["Invalid assessment id."] });
    }

    const result = toAdminResult(repo.getAssessmentById(id));
    if (!result) {
      return res.status(404).json({ success: false, errors: ["No viewable result for that assessment."] });
    }

    res.json({ success: true, data: result });
  });

  // POST /api/admin/import-kit — rebuild records for people who completed an
  // assessment before this database held them. Safe to run repeatedly: anyone
  // already imported is skipped.
  router.post("/import-kit", requireAdmin, async (req, res) => {
    try {
      const summary = await importFromKit(
        repo,
        () => createUniqueShareId(candidate => repo.shareIdExists(candidate)),
      );

      if (!summary.ok) {
        return res.status(503).json({ success: false, errors: [summary.message] });
      }

      console.log(`[Kit Import] Scanned ${summary.scanned} subscribers, imported ${summary.imported}, skipped ${summary.skipped}.`);
      return res.json({ success: true, data: summary });
    } catch (err) {
      console.error("[Kit Import] Failed:", err.message);
      return res.status(502).json({ success: false, errors: ["Kit import failed: " + err.message] });
    }
  });

  return router;
}

module.exports = { createAdminRoutes };
