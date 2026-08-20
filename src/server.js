const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { initializeDatabase } = require("./db/schema");
const { createRepository } = require("./db/repository");
const { createRoutes } = require("./routes/assessment");
const { createAdminRoutes } = require("./routes/admin");
const { ensureCustomFields } = require("./services/kit-custom-fields");
const { isValidShareId } = require("./services/share-id");
const { toPublicResult } = require("./services/public-result");
const { createSharePageRenderer, applyNoIndex } = require("./services/share-page");
const { isAdminEnabled } = require("./services/admin-auth");
const { startRetryLoop } = require("./services/kit-retry");

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";

const ALLOWED_ORIGINS = [
  // Production
  "https://assessment.theautonomousleader.com",
  "https://theautonomousleader.com",
  "https://www.theautonomousleader.com",
  "https://tal-assessment-production.up.railway.app",
  // Development
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  // file:// origin sends null — allow during development
  "null",
];

// ─── Initialize ─────────────────────────────────────────────────────────────

const db = initializeDatabase();
const repo = createRepository(db);

console.log(`[DB] SQLite initialized. Counter at: ${repo.getCounter()}`);

// ─── Express App ────────────────────────────────────────────────────────────

const INDEX_PATH = path.join(__dirname, "../public/index.html");
const renderSharePage = createSharePageRenderer(INDEX_PATH);

const app = express();

// Railway runs the app behind its own proxy. Trusting exactly one hop gives the
// login throttle the caller's real address instead of the proxy's.
app.set("trust proxy", 1);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (same-origin, curl, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error("CORS not allowed from: " + origin));
  },
  methods: ["GET", "POST", "PATCH"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json({ limit: "100kb" }));

// Shareable result pages: same SPA, but with link-preview tags for this result
// so it unfurls correctly in iMessage, Slack, LinkedIn and WhatsApp.
app.get("/r/:shareId", (req, res) => {
  const { shareId } = req.params;
  const row = isValidShareId(shareId) ? repo.getAssessmentByShareId(shareId) : null;
  const result = toPublicResult(row);

  // Unknown link: still serve the app, which shows a "link unavailable" notice.
  if (!result) {
    return res.status(404).sendFile(INDEX_PATH);
  }

  res.type("html").send(renderSharePage(result));
});

// Admin console: the same SPA, never indexed.
app.get("/admin", (req, res) => {
  res.type("html").send(applyNoIndex(fs.readFileSync(INDEX_PATH, "utf8")));
});

// Serve the assessment frontend from /public
app.use(express.static(path.join(__dirname, "../public")));

// Mount API routes
app.use("/api", createRoutes(repo));
app.use("/api/admin", createAdminRoutes(repo));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", env: NODE_ENV, counter: repo.getCounter() });
});

// Fallback: serve index.html for any non-API route (SPA-style)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─── Kit.com Startup ────────────────────────────────────────────────────────

// Ensure custom fields exist (idempotent, no-op without API key)
ensureCustomFields(process.env.KIT_API_SECRET).catch(err => {
  console.error("[Startup] Kit custom field setup failed:", err.message);
});

// Retry unsynced assessments every 5 minutes
startRetryLoop(repo, 5 * 60 * 1000);

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[Server] TAL Assessment running on port ${PORT} (${NODE_ENV})`);
  console.log(`[Server] Admin:    ${isAdminEnabled() ? "enabled at /admin" : "disabled (set ADMIN_PASSWORD to enable)"}`);
  console.log(`[Server] Frontend: http://localhost:${PORT}`);
  console.log(`[Server] API:      http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  db.close();
  process.exit(0);
});
