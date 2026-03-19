const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Railway volume mount: set DATA_DIR env var to persistent storage path
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "tal-assessment.db");

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
  `);

  return db;
}

module.exports = { initializeDatabase, DB_PATH };
