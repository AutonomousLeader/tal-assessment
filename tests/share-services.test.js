const test = require("node:test");
const assert = require("node:assert");

const { generateShareId, isValidShareId, createUniqueShareId } = require("../src/services/share-id");
const { toPublicResult } = require("../src/services/public-result");
const { applyShareMeta, buildTitle, buildDescription } = require("../src/services/share-page");

// ─── share-id ───────────────────────────────────────────────────────────────

test("generates URL-safe ids that pass validation", () => {
  for (let i = 0; i < 200; i++) {
    const id = generateShareId();
    assert.match(id, /^[A-Za-z0-9_-]+$/);
    assert.ok(isValidShareId(id), `rejected its own id: ${id}`);
  }
});

test("generates a distinct id every time", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(generateShareId());
  assert.strictEqual(ids.size, 1000);
});

test("rejects ids that could be path traversal or SQL noise", () => {
  ["", "../../etc/passwd", "short", "has space", "drop;table", null, undefined, 42].forEach(value => {
    assert.strictEqual(isValidShareId(value), false, `accepted: ${value}`);
  });
});

test("retries past a collision", () => {
  let calls = 0;
  const id = createUniqueShareId(() => {
    calls++;
    return calls <= 2; // first two candidates are taken
  });
  assert.ok(isValidShareId(id));
  assert.strictEqual(calls, 3);
});

test("gives up rather than looping forever when every id is taken", () => {
  assert.throws(() => createUniqueShareId(() => true), /unique share id/);
});

// ─── public-result ──────────────────────────────────────────────────────────

const quickRow = {
  id: 7,
  share_id: "abcd1234efgh",
  email: "owner@example.com",
  first_name: "Dana",
  assessment_type: "quick",
  level_result: 4,
  flagged: 1,
  individual_answers: JSON.stringify(["yes","yes","inProgress","notYet","yes","inProgress","yes","notYet","yes","inProgress","yes","yes"]),
  tags: JSON.stringify(["tal-level-4"]),
  kit_subscriber_id: "sub_123",
  created_at: "2026-08-20 10:00:00",
};

const deepRow = {
  id: 8,
  share_id: "ijkl5678mnop",
  email: "sam@example.com",
  first_name: "Sam",
  assessment_type: "deep",
  level_result: 3,
  deep_answers: JSON.stringify(Array(18).fill("3")),
  primary_constraint: "People",
  superpower: "Power",
  p_levels: JSON.stringify({ People: 2 }),
  tags: JSON.stringify(["tal-level-3"]),
  kit_subscriber_id: "sub_456",
  created_at: "2026-08-20 11:00:00",
};

test("a shared quick result carries the answers and the level", () => {
  const result = toPublicResult(quickRow);
  assert.strictEqual(result.assessmentType, "quick");
  assert.strictEqual(result.firstName, "Dana");
  assert.strictEqual(result.levelResult, 4);
  assert.strictEqual(result.levelLabel, "Level 4 — The Systems Builder");
  assert.strictEqual(result.individualAnswers.length, 12);
});

test("a shared deep result carries constraint and superpower", () => {
  const result = toPublicResult(deepRow);
  assert.strictEqual(result.assessmentType, "deep");
  assert.strictEqual(result.deepAnswers.length, 18);
  assert.strictEqual(result.primaryConstraint, "People");
  assert.strictEqual(result.superpower, "Power");
});

test("a shared result never exposes email, tags, flag state or Kit ids", () => {
  [quickRow, deepRow].forEach(row => {
    const serialized = JSON.stringify(toPublicResult(row));
    assert.ok(!serialized.includes("@example.com"), "email leaked");
    assert.ok(!serialized.includes("sub_"), "Kit subscriber id leaked");
    assert.ok(!serialized.includes("tal-level-"), "Kit tags leaked");
    assert.ok(!/"flagged"/.test(serialized), "outreach flag leaked");
    assert.ok(!/"id":\s*\d/.test(serialized), "internal row id leaked");
  });
});

test("returns null only when there is no viewable result at all", () => {
  assert.strictEqual(toPublicResult(null), null);
  assert.strictEqual(toPublicResult({ ...quickRow, share_id: null }), null);
  assert.strictEqual(toPublicResult({ ...quickRow, assessment_type: "other" }), null);
  assert.strictEqual(toPublicResult({ ...quickRow, level_result: null }), null);
  assert.strictEqual(toPublicResult({ ...quickRow, level_result: 9 }), null);
});

test("a row whose answers are gone still shows the level it reached", () => {
  ["full", "levels", "level-only"].forEach(detail => assert.ok(detail));

  const withoutAnswers = toPublicResult({ ...quickRow, individual_answers: null });
  assert.strictEqual(withoutAnswers.detail, "level-only");
  assert.strictEqual(withoutAnswers.levelLabel, "Level 4 — The Systems Builder");

  const corrupt = toPublicResult({ ...quickRow, individual_answers: "not json" });
  assert.strictEqual(corrupt.detail, "level-only");

  const truncated = toPublicResult({ ...quickRow, individual_answers: JSON.stringify(["yes"]) });
  assert.strictEqual(truncated.detail, "level-only");
});

test("an imported deep record redraws the profile from its nine P levels", () => {
  const pLevels = { Pipeline: 6, Profit: 2, Perspective: 4, Principles: 5, Program: 3, People: 6, Process: 2, Progress: 5, Power: 4 };
  const imported = toPublicResult({
    ...deepRow, deep_answers: null, source: "kit-import", p_levels: JSON.stringify(pLevels),
    primary_constraint: "Profit", superpower: "People",
  });

  assert.strictEqual(imported.detail, "levels");
  assert.deepStrictEqual(imported.pLevels, pLevels);
  assert.strictEqual(imported.primaryConstraint, "Profit");
  assert.strictEqual(imported.source, "kit-import");

  // A partial or malformed profile falls back rather than drawing a wrong wheel.
  const partial = toPublicResult({ ...deepRow, deep_answers: null, p_levels: JSON.stringify({ Pipeline: 6 }) });
  assert.strictEqual(partial.detail, "level-only");

  const outOfRange = toPublicResult({ ...deepRow, deep_answers: null, p_levels: JSON.stringify({ ...pLevels, Power: 99 }) });
  assert.strictEqual(outOfRange.detail, "level-only");
});

test("a constraint that is not one of the nine P's is dropped, not displayed", () => {
  const result = toPublicResult({ ...deepRow, primary_constraint: "Nonsense", superpower: "people" });
  assert.strictEqual(result.primaryConstraint, null);
  assert.strictEqual(result.superpower, null, "lowercase names must not slip through as P keys");
});

// ─── share-page ─────────────────────────────────────────────────────────────

const PAGE = `<head>
  <title>The Autonomous Leader Self Assessment</title>
  <meta name="description" content="generic">
  <meta property="og:title" content="generic">
  <meta property="og:description" content="generic">
  <meta property="og:url" content="https://assessment.theautonomousleader.com">
  <meta name="twitter:title" content="generic">
  <meta name="twitter:description" content="generic">
</head><body></body>`;

test("link preview tags describe the specific result", () => {
  const html = applyShareMeta(PAGE, toPublicResult(deepRow));
  assert.match(html, /<title>Sam&#39;s result: Level 3 — The Multiplier<\/title>/);
  assert.match(html, /property="og:title" content="Sam&#39;s result: Level 3/);
  assert.match(html, /property="og:description" content="[^"]*Primary constraint: People/);
  assert.match(html, /property="og:url" content="[^"]*\/r\/ijkl5678mnop"/);
  assert.match(html, /name="twitter:description" content="[^"]*Superpower: Power/);
  assert.ok(!html.includes('content="generic"'), "a preview tag was left generic");
});

test("someone else's result is not indexable", () => {
  const html = applyShareMeta(PAGE, toPublicResult(quickRow));
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test("a name cannot break out of an attribute", () => {
  const hostile = toPublicResult({ ...quickRow, first_name: '"><script>alert(1)</script>' });
  const html = applyShareMeta(PAGE, hostile);
  assert.ok(!html.includes("<script>alert(1)</script>"), "unescaped markup reached the page");
  assert.match(html, /&lt;script&gt;/);
});

test("falls back cleanly when no name was given", () => {
  const anonymous = toPublicResult({ ...quickRow, first_name: null });
  assert.strictEqual(buildTitle(anonymous), "Level 4 — The Systems Builder");
  assert.match(buildDescription(anonymous), /^A business owner ran/);
});
