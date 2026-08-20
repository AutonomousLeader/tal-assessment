const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

// schema.js reads DATA_DIR when it loads, so point it at a scratch directory
// before requiring it.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tal-share-test-"));
process.env.DATA_DIR = DATA_DIR;

const { initializeDatabase, DB_PATH } = require("../src/db/schema");
const { createRepository } = require("../src/db/repository");

// The assessments table exactly as it existed before shareable links — this is
// what the production volume holds today.
const LEGACY_SCHEMA = `
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    first_name TEXT,
    assessment_type TEXT NOT NULL CHECK(assessment_type IN ('quick', 'deep')),
    level_result INTEGER NOT NULL CHECK(level_result BETWEEN 1 AND 7),
    flagged INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER,
    category_scores TEXT,
    individual_answers TEXT,
    p_levels TEXT,
    primary_constraint TEXT,
    superpower TEXT,
    deep_answers TEXT,
    tags TEXT,
    kit_synced INTEGER NOT NULL DEFAULT 0,
    kit_subscriber_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function seedLegacyDatabase(rowCount) {
  const db = new Database(DB_PATH);
  db.exec(LEGACY_SCHEMA);
  const insert = db.prepare(`
    INSERT INTO assessments (email, first_name, assessment_type, level_result, individual_answers)
    VALUES (?, ?, 'quick', 4, ?)
  `);
  const answers = JSON.stringify(Array(12).fill("yes"));
  for (let i = 1; i <= rowCount; i++) insert.run(`owner${i}@example.com`, `Owner ${i}`, answers);
  db.close();
}

function readShareIds(db) {
  return db.prepare("SELECT id, share_id FROM assessments ORDER BY id").all();
}

test("an existing database gains share links without losing data", (t) => {
  seedLegacyDatabase(3);

  const db = initializeDatabase();
  t.after(() => db.close());

  const rows = readShareIds(db);
  assert.strictEqual(rows.length, 3, "existing rows were dropped");
  rows.forEach(row => assert.match(row.share_id || "", /^[A-Za-z0-9_-]{8,64}$/, `row ${row.id} was not backfilled`));
  assert.strictEqual(new Set(rows.map(r => r.share_id)).size, 3, "backfilled ids collided");
});

test("re-running the migration keeps the links people already have", (t) => {
  const first = initializeDatabase();
  const before = readShareIds(first);
  first.close();

  const second = initializeDatabase();
  t.after(() => second.close());
  const after = readShareIds(second);

  assert.deepStrictEqual(after, before, "share links changed on restart");
});

test("two results cannot share one link", (t) => {
  const db = initializeDatabase();
  t.after(() => db.close());

  const taken = db.prepare("SELECT share_id FROM assessments WHERE id = 1").get().share_id;
  assert.throws(
    () => db.prepare("UPDATE assessments SET share_id = ? WHERE id = 2").run(taken),
    /UNIQUE/,
  );
});

test("a new assessment is stored with, and readable by, its share id", (t) => {
  const db = initializeDatabase();
  t.after(() => db.close());
  const repo = createRepository(db);

  const shareId = "TestShareId1";
  repo.insertAssessment({
    email: "new@example.com",
    firstName: "Riley",
    assessmentType: "deep",
    levelResult: 3,
    flagged: false,
    pLevels: { People: 2 },
    primaryConstraint: "People",
    superpower: "Power",
    deepAnswers: Array(18).fill("3"),
    shareId,
    tags: ["tal-level-3"],
  });

  const row = repo.getAssessmentByShareId(shareId);
  assert.strictEqual(row.email, "new@example.com");
  assert.strictEqual(row.primary_constraint, "People");
  assert.strictEqual(repo.shareIdExists(shareId), true);
  assert.strictEqual(repo.shareIdExists("NotARealId1"), false);
  assert.strictEqual(repo.getAssessmentByShareId("NotARealId1"), null);
});
