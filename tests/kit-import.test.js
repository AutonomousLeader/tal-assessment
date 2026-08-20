const test = require("node:test");
const assert = require("node:assert");

const { importFromKit, toImportedAssessment, toSqliteTimestamp } = require("../src/services/kit-import");

// A subscriber shaped like the ones in Kit today.
function deepSubscriber(overrides = {}) {
  return {
    id: 77,
    email_address: "dphipps@mcre.dev",
    first_name: "David",
    created_at: "2026-07-14T18:22:00.000Z",
    fields: {
      tal_first_name: "David",
      tal_level: "5",
      tal_assessment_type: "deep",
      tal_constraint: "Profit",
      tal_superpower: "People",
      tal_pipeline_level: "6",
      tal_profit_level: "2",
      tal_perspective_level: "4",
      tal_principles_level: "5",
      tal_program_level: "3",
      tal_people_level: "6",
      tal_process_level: "2",
      tal_progress_level: "5",
      tal_power_level: "4",
    },
    ...overrides,
  };
}

// ─── Mapping ────────────────────────────────────────────────────────────────

test("an in-depth subscriber comes back with all nine P levels", () => {
  const record = toImportedAssessment(deepSubscriber());

  assert.strictEqual(record.email, "dphipps@mcre.dev");
  assert.strictEqual(record.firstName, "David");
  assert.strictEqual(record.assessmentType, "deep");
  assert.strictEqual(record.levelResult, 5);
  assert.strictEqual(record.primaryConstraint, "Profit");
  assert.strictEqual(record.superpower, "People");
  assert.deepStrictEqual(record.pLevels, {
    Pipeline: 6, Profit: 2, Perspective: 4, Principles: 5, Program: 3,
    People: 6, Process: 2, Progress: 5, Power: 4,
  });
  assert.strictEqual(record.createdAt, "2026-07-14 18:22:00");
  assert.strictEqual(record.flagged, false);
});

test("the outreach tag marks someone who asked to be contacted", () => {
  const record = toImportedAssessment(deepSubscriber(), new Set(["77"]));
  assert.strictEqual(record.flagged, true);
});

test("a quick subscriber imports as a level with no P profile", () => {
  const record = toImportedAssessment({
    id: 12, email_address: "jo@example.com", created_at: "2026-06-01T10:00:00.000Z",
    fields: { tal_level: "3", tal_assessment_type: "quick", tal_first_name: "Jo" },
  });

  assert.strictEqual(record.assessmentType, "quick");
  assert.strictEqual(record.levelResult, 3);
  assert.strictEqual(record.pLevels, null);
  assert.strictEqual(record.primaryConstraint, null);
});

test("subscribers who never completed an assessment are left alone", () => {
  assert.strictEqual(toImportedAssessment({ id: 1, email_address: "a@b.com", fields: {} }), null);
  assert.strictEqual(toImportedAssessment({ id: 2, email_address: "a@b.com", fields: { tal_level: "" } }), null);
  assert.strictEqual(toImportedAssessment({ id: 3, email_address: "a@b.com", fields: { tal_level: "12" } }), null);
  assert.strictEqual(toImportedAssessment({ id: 4, fields: { tal_level: "3" } }), null, "no email means no record");
});

test("an incomplete P profile does not become a half-drawn wheel", () => {
  const partial = deepSubscriber();
  delete partial.fields.tal_power_level;

  const record = toImportedAssessment(partial);
  assert.strictEqual(record.assessmentType, "deep");
  assert.strictEqual(record.pLevels, null);
});

test("a missing type is inferred from whether P levels exist", () => {
  const noType = deepSubscriber();
  delete noType.fields.tal_assessment_type;
  assert.strictEqual(toImportedAssessment(noType).assessmentType, "deep");

  assert.strictEqual(toImportedAssessment({
    id: 5, email_address: "a@b.com", fields: { tal_level: "2" },
  }).assessmentType, "quick");
});

test("timestamps convert to the format the database stores", () => {
  assert.strictEqual(toSqliteTimestamp("2026-07-14T18:22:00.000Z"), "2026-07-14 18:22:00");
  assert.strictEqual(toSqliteTimestamp("nonsense"), null);
  assert.strictEqual(toSqliteTimestamp(null), null);
});

// ─── The import itself ──────────────────────────────────────────────────────

function fakeKit({ subscribers, tags = [], byTag = {}, lookups = null }) {
  return async (input) => {
    const url = new URL(String(input));
    const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    const page = { has_next_page: false, end_cursor: null };

    if (url.pathname.endsWith("/tags")) return json({ tags, pagination: page });

    const tagMatch = url.pathname.match(/\/tags\/(\d+)\/subscribers$/);
    if (tagMatch) return json({ subscribers: byTag[tagMatch[1]] || [], pagination: page });

    const oneMatch = url.pathname.match(/\/subscribers\/(\d+)$/);
    if (oneMatch) {
      if (lookups) lookups.push(oneMatch[1]);
      const found = subscribers.find(s => String(s.id) === oneMatch[1]);
      return json({ subscriber: found || null });
    }

    if (url.pathname.endsWith("/subscribers")) return json({ subscribers, pagination: page });

    return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  };
}

function stubRepo() {
  const rows = [];
  return {
    rows,
    getImportedByKitSubscriberId: id => rows.find(r => r.kitSubscriberId === String(id)) || null,
    insertAssessment: data => { rows.push(data); return rows.length; },
    shareIdExists: () => false,
  };
}

test("importing brings in every past taker and skips them next time", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const subscribers = [
    deepSubscriber(),
    { id: 12, email_address: "jo@example.com", created_at: "2026-06-01T10:00:00.000Z", fields: { tal_level: "3", tal_assessment_type: "quick" } },
    { id: 99, email_address: "newsletter@example.com", created_at: "2026-06-02T10:00:00.000Z", fields: {} },
  ];

  globalThis.fetch = fakeKit({
    subscribers,
    tags: [{ id: 5, name: "tal-outreach-requested" }],
    byTag: { 5: [{ id: 77 }] },
  });

  const repo = stubRepo();
  let counter = 0;
  const createShareId = () => "ImportedShare" + (++counter);

  const first = await importFromKit(repo, createShareId, "fake-key");
  assert.strictEqual(first.scanned, 3);
  assert.strictEqual(first.imported, 2, "the plain newsletter subscriber should be left out");
  assert.strictEqual(first.withLevels, 1);
  assert.strictEqual(first.levelOnly, 1);

  const stored = repo.rows[0];
  assert.strictEqual(stored.source, "kit-import");
  assert.strictEqual(stored.kitSynced, true, "imported rows must not re-enter the Kit sync queue");
  assert.strictEqual(stored.flagged, true);
  assert.strictEqual(stored.shareId, "ImportedShare1");

  const second = await importFromKit(repo, createShareId, "fake-key");
  assert.strictEqual(second.imported, 0, "a second run duplicated people");
  assert.strictEqual(second.skipped, 2);
  assert.strictEqual(repo.rows.length, 2);
});

test("importing without a Kit key reports why instead of failing silently", async () => {
  const summary = await importFromKit(stubRepo(), () => "x", "");
  assert.strictEqual(summary.ok, false);
  assert.match(summary.message, /KIT_API_SECRET/);
});

test("a Kit outage surfaces as an error, not a partial import", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "upstream boom", json: async () => ({}) });

  await assert.rejects(() => importFromKit(stubRepo(), () => "x", "fake-key"), /Kit request failed \(500\)/);
});


test("the completed-assessment tag is used instead of scanning every subscriber", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const taker = deepSubscriber();
  globalThis.fetch = fakeKit({
    subscribers: [taker, { id: 99, email_address: "newsletter@example.com", fields: {} }],
    tags: [{ id: 3, name: "tal-assessment-completed" }, { id: 5, name: "tal-outreach-requested" }],
    byTag: { 3: [taker], 5: [] },
  });

  const summary = await importFromKit(stubRepo(), () => "ShareIdOne12", "fake-key");
  assert.strictEqual(summary.scannedAll, false, "should have used the tag, not a full scan");
  assert.strictEqual(summary.scanned, 1);
  assert.strictEqual(summary.imported, 1);
});

test("a tag listing that wraps the subscriber is unwrapped", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const taker = deepSubscriber();
  globalThis.fetch = fakeKit({
    subscribers: [taker],
    tags: [{ id: 3, name: "tal-assessment-completed" }],
    byTag: { 3: [{ id: 1, created_at: "2026-07-14T18:22:00.000Z", subscriber: taker }] },
  });

  const repo = stubRepo();
  const summary = await importFromKit(repo, () => "ShareIdTwo12", "fake-key");
  assert.strictEqual(summary.imported, 1);
  assert.strictEqual(repo.rows[0].email, "dphipps@mcre.dev");
});

test("a listing without custom fields falls back to reading each subscriber", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const taker = deepSubscriber();
  const withoutFields = { id: taker.id, email_address: taker.email_address, created_at: taker.created_at };
  const lookups = [];

  globalThis.fetch = fakeKit({
    subscribers: [taker],
    tags: [{ id: 3, name: "tal-assessment-completed" }],
    byTag: { 3: [withoutFields] },
    lookups,
  });

  const repo = stubRepo();
  const summary = await importFromKit(repo, () => "ShareIdThree", "fake-key");
  assert.deepStrictEqual(lookups, ["77"], "should have fetched the subscriber for its fields");
  assert.strictEqual(summary.imported, 1);
  assert.strictEqual(repo.rows[0].levelResult, 5);
  assert.deepStrictEqual(Object.keys(repo.rows[0].pLevels).length, 9);
});
