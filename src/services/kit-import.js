// Rebuilds assessment records from Kit.com custom fields.
//
// Everyone who completed an assessment was synced to Kit with their level, and
// for in-depth takers all nine P levels. That is enough to reconstruct the
// result page, even when the original answers are gone from this database.
// Raw answers are not stored in Kit, so imported records carry levels only.

const KIT_API_URL = "https://api.kit.com/v4";
const PAGE_SIZE = 500;
const MAX_PAGES = 50; // 25k subscribers — a backstop, not an expected limit
const OUTREACH_TAG = "tal-outreach-requested";
const COMPLETED_TAG = "tal-assessment-completed";

const P_FIELD_MAP = {
  Pipeline: "tal_pipeline_level",
  Profit: "tal_profit_level",
  Perspective: "tal_perspective_level",
  Principles: "tal_principles_level",
  Program: "tal_program_level",
  People: "tal_people_level",
  Process: "tal_process_level",
  Progress: "tal_progress_level",
  Power: "tal_power_level",
};

const P_NAMES = Object.keys(P_FIELD_MAP);

function kitHeaders(apiSecret) {
  return { "Content-Type": "application/json", "X-Kit-Api-Key": apiSecret };
}

async function kitGet(apiSecret, pathname, params = {}) {
  const url = new URL(KIT_API_URL + pathname);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const res = await fetch(url, { method: "GET", headers: kitHeaders(apiSecret) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kit request failed (${res.status}) for ${pathname}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Walks a cursor-paginated Kit collection and returns every item.
async function fetchAll(apiSecret, pathname, collectionKey) {
  const items = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await kitGet(apiSecret, pathname, { per_page: PAGE_SIZE, after: cursor });
    const batch = body[collectionKey] || [];
    items.push(...batch);

    const pagination = body.pagination || {};
    if (!pagination.has_next_page || !pagination.end_cursor) return items;
    cursor = pagination.end_cursor;
  }

  return items;
}

// ─── Field reading ──────────────────────────────────────────────────────────

function readLevel(value) {
  const level = Number.parseInt(value, 10);
  return Number.isInteger(level) && level >= 1 && level <= 7 ? level : null;
}

function readPLevels(fields) {
  const entries = P_NAMES.map(pName => [pName, readLevel(fields[P_FIELD_MAP[pName]])]);
  if (entries.some(([, level]) => level === null)) return null;
  return Object.fromEntries(entries);
}

function readPName(value) {
  if (typeof value !== "string") return null;
  const match = P_NAMES.find(pName => pName.toLowerCase() === value.trim().toLowerCase());
  return match || null;
}

// Kit timestamps are ISO; SQLite rows are "YYYY-MM-DD HH:MM:SS" in UTC.
function toSqliteTimestamp(isoString) {
  if (!isoString) return null;
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

// Returns null for a subscriber who never completed an assessment.
function toImportedAssessment(subscriber, flaggedIds = new Set()) {
  const fields = (subscriber && subscriber.fields) || {};
  const levelResult = readLevel(fields.tal_level);
  const email = subscriber && subscriber.email_address;
  if (!levelResult || !email) return null;

  const pLevels = readPLevels(fields);
  const declaredType = typeof fields.tal_assessment_type === "string"
    ? fields.tal_assessment_type.trim().toLowerCase()
    : "";
  const assessmentType = declaredType === "quick" || declaredType === "deep"
    ? declaredType
    : (pLevels ? "deep" : "quick");

  return {
    email,
    firstName: fields.tal_first_name || subscriber.first_name || null,
    assessmentType,
    levelResult,
    flagged: flaggedIds.has(String(subscriber.id)),
    pLevels: assessmentType === "deep" ? pLevels : null,
    primaryConstraint: assessmentType === "deep" ? readPName(fields.tal_constraint) : null,
    superpower: assessmentType === "deep" ? readPName(fields.tal_superpower) : null,
    kitSubscriberId: String(subscriber.id),
    createdAt: toSqliteTimestamp(subscriber.created_at),
  };
}

// ─── Import ─────────────────────────────────────────────────────────────────

// A tag listing may return the subscriber inline or wrapped in a membership
// record. Both shapes appear across Kit's endpoints.
function unwrapSubscriber(entry) {
  if (!entry) return null;
  return entry.subscriber && typeof entry.subscriber === "object" ? entry.subscriber : entry;
}

async function fetchTagSubscribers(apiSecret, tags, tagName) {
  const tag = tags.find(candidate => candidate.name === tagName);
  if (!tag) return null;
  const entries = await fetchAll(apiSecret, `/tags/${tag.id}/subscribers`, "subscribers");
  return entries.map(unwrapSubscriber).filter(Boolean);
}

// Custom fields are what the whole import rests on. When a listing omits them,
// read the subscriber directly rather than importing an empty record.
async function withFields(apiSecret, subscriber) {
  if (subscriber && subscriber.fields && typeof subscriber.fields === "object") return subscriber;
  if (!subscriber || !subscriber.id) return subscriber;

  const body = await kitGet(apiSecret, `/subscribers/${subscriber.id}`);
  return body.subscriber || subscriber;
}

async function fetchFlaggedSubscriberIds(apiSecret, tags) {
  const flagged = await fetchTagSubscribers(apiSecret, tags, OUTREACH_TAG);
  if (!flagged) return new Set();
  return new Set(flagged.map(entry => String(entry.id)));
}

// Prefer the completed-assessment tag: it is exactly the people we want, and it
// keeps any per-subscriber lookups down to that group. Falls back to scanning
// every subscriber when the tag is missing.
async function fetchCandidates(apiSecret, tags) {
  const tagged = await fetchTagSubscribers(apiSecret, tags, COMPLETED_TAG);
  if (tagged && tagged.length > 0) return { candidates: tagged, scannedAll: false };

  const everyone = await fetchAll(apiSecret, "/subscribers", "subscribers");
  return { candidates: everyone, scannedAll: true };
}

async function importFromKit(repo, createShareId, apiSecret = process.env.KIT_API_SECRET) {
  if (!apiSecret) {
    return { ok: false, reason: "no_api_key", message: "KIT_API_SECRET is not set on this server." };
  }

  const tags = await fetchAll(apiSecret, "/tags", "tags");
  const flaggedIds = await fetchFlaggedSubscriberIds(apiSecret, tags);
  const { candidates, scannedAll } = await fetchCandidates(apiSecret, tags);

  const summary = {
    ok: true,
    scanned: candidates.length,
    imported: 0,
    skipped: 0,
    withLevels: 0,
    levelOnly: 0,
    scannedAll,
  };

  for (const candidate of candidates) {
    const subscriber = await withFields(apiSecret, candidate);
    const record = toImportedAssessment(subscriber, flaggedIds);
    if (!record) continue;

    if (repo.getImportedByKitSubscriberId(record.kitSubscriberId)) {
      summary.skipped++;
      continue;
    }

    repo.insertAssessment({
      ...record,
      shareId: createShareId(),
      source: "kit-import",
      kitSynced: true,
      tags: null,
    });

    summary.imported++;
    if (record.pLevels) summary.withLevels++;
    else summary.levelOnly++;
  }

  return summary;
}

module.exports = {
  importFromKit,
  unwrapSubscriber,
  toImportedAssessment,
  readPLevels,
  toSqliteTimestamp,
  P_FIELD_MAP,
};
