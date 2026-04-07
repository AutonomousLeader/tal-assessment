const path = require("path");
const express = require("express");
const cors = require("cors");
const { initializeDatabase } = require("./db/schema");
const { createRepository } = require("./db/repository");
const { createRoutes } = require("./routes/assessment");
const { ensureCustomFields } = require("./services/kit-custom-fields");
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

const app = express();

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

// Serve the assessment frontend from /public
app.use(express.static(path.join(__dirname, "../public")));

// Mount API routes
app.use("/api", createRoutes(repo));

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
  console.log(`[Server] Frontend: http://localhost:${PORT}`);
  console.log(`[Server] API:      http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  db.close();
  process.exit(0);
});
