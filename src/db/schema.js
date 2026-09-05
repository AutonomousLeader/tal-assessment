const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { generateShareId } = require("../services/share-id");

// Railway volume mount: set DATA_DIR env var to persistent storage path
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "tal-assessment.db");

// ─── Migrations ─────────────────────────────────────────────────────────────

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(col => col.name === column);
}

// Adds share_id to databases created before shareable result links existed, and
// gives every historical row an id so old results become shareable too.
// Safe to run on every boot: the column check and the backfill are both no-ops
// once they have run.
// Marks where a record came from. Rows that predate the column were all taken
// on the site.
function migrateSource(db) {
  if (hasColumn(db, "assessments", "source")) return;
  db.exec("ALTER TABLE assessments ADD COLUMN source TEXT NOT NULL DEFAULT 'assessment'");
}

function migrateShareIds(db) {
  if (!hasColumn(db, "assessments", "share_id")) {
    db.exec("ALTER TABLE assessments ADD COLUMN share_id TEXT");
  }

  // SQLite treats NULLs as distinct, so this holds while rows are being
  // backfilled and stops two results ever answering to one link afterwards.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_assessments_share_id ON assessments(share_id)");

  const pending = db.prepare("SELECT id FROM assessments WHERE share_id IS NULL").all();
  if (pending.length === 0) return 0;

  const updateShareId = db.prepare("UPDATE assessments SET share_id = ? WHERE id = ?");
  const backfill = db.transaction(rows => {
    rows.forEach(row => updateShareId.run(generateShareId(), row.id));
  });
  backfill(pending);

  return pending.length;
}

function initializeDatabase() {
  // Ensure the data directory exists (Railway clones fresh repo without it)
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      first_name TEXT,
      assessment_type TEXT NOT NULL CHECK(assessment_type IN ('quick', 'deep')),
      level_result INTEGER NOT NULL CHECK(level_result BETWEEN 1 AND 7),
      flagged INTEGER NOT NULL DEFAULT 0,

      -- Quick assessment fields (NULL for deep)
      total_points INTEGER,
      category_scores TEXT,
      individual_answers TEXT,

      -- Deep assessment fields (NULL for quick)
      p_levels TEXT,
      primary_constraint TEXT,
      superpower TEXT,
      deep_answers TEXT,

      -- Public, unguessable id used in shareable result links (/r/:shareId)
      share_id TEXT,

      -- 'assessment' for someone who took it here, 'kit-import' for a record
      -- rebuilt from Kit.com custom fields (no raw answers to replay)
      source TEXT NOT NULL DEFAULT 'assessment',

      -- Tags sent to Kit.com
      tags TEXT,

      -- Kit.com sync status
      kit_synced INTEGER NOT NULL DEFAULT 0,
      kit_subscriber_id TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assessments_email ON assessments(email);
    CREATE INDEX IF NOT EXISTS idx_assessments_created_at ON assessments(created_at);
    CREATE INDEX IF NOT EXISTS idx_assessments_kit_synced ON assessments(kit_synced);

    CREATE TABLE IF NOT EXISTS counter (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      count INTEGER NOT NULL DEFAULT 421
    );

    INSERT OR IGNORE INTO counter (id, count) VALUES (1, 421);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      assessment_id INTEGER,
      remind_at TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_sent ON reminders(sent);

    -- Scheduled funnel emails (replaces Kit's automation delays). Each row is
    -- one email to send at send_at. The scheduler (services/email/scheduler.js)
    -- sends due rows and marks them. status: pending | sent | skipped | failed.
    CREATE TABLE IF NOT EXISTS email_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      first_name TEXT,
      template_key TEXT NOT NULL,
      assessment_id INTEGER,
      context TEXT,                       -- JSON Liquid context ({ subscriber: {...} })
      condition TEXT,                     -- optional gate, e.g. 'skip_if_deep'
      send_at TEXT NOT NULL,              -- UTC 'YYYY-MM-DD HH:MM:SS'
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      provider_id TEXT,                   -- Resend message id once sent
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_email_jobs_due ON email_jobs(status, send_at);
    CREATE INDEX IF NOT EXISTS idx_email_jobs_email ON email_jobs(email);
  `);

  migrateSource(db);

  const backfilled = migrateShareIds(db);
  if (backfilled > 0) {
    console.log(`[DB] Backfilled share links for ${backfilled} existing assessment(s).`);
  }

  return db;
}

module.exports = { initializeDatabase, DB_PATH };
