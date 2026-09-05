#!/usr/bin/env node
// Daily SQLite backup — replaces "Kit is our backup" (kit-import.js).
//
// Uses better-sqlite3's online backup (safe on a live WAL database), writes a
// dated copy into BACKUP_DIR, and prunes to the most recent BACKUP_KEEP files.
//
// Run it from a Railway cron service (recommended): a separate service on the
// same volume, schedule "0 7 * * *" (07:00 UTC daily), start command:
//   node scripts/backup-db.js
//
// Env:
//   DATA_DIR      where tal-assessment.db lives (same as the app)
//   BACKUP_DIR    where to write backups (default: <DATA_DIR>/backups)
//   BACKUP_KEEP   how many dated backups to retain (default: 30)

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "tal-assessment.db");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
const KEEP = Number.parseInt(process.env.BACKUP_KEEP || "30", 10);

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[Backup] No database at ${DB_PATH} — nothing to back up.`);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const dest = path.join(BACKUP_DIR, `tal-assessment-${stamp}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(dest);
  db.close();

  const bytes = fs.statSync(dest).size;
  console.log(`[Backup] Wrote ${dest} (${(bytes / 1024).toFixed(1)} KB)`);

  // Prune oldest beyond KEEP.
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("tal-assessment-") && f.endsWith(".db"))
    .sort(); // ISO stamp sorts chronologically
  const excess = files.length - KEEP;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
    console.log(`[Backup] Pruned old backup ${files[i]}`);
  }
}

main().catch(err => {
  console.error("[Backup] Failed:", err.message);
  process.exit(1);
});
