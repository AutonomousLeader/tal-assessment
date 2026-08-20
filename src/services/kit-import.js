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

async function fetchFlaggedSubscriberIds(apiSecret) {
  const tags = await fetchAll(apiSecret, "/tags", "tags");
  const outreachTag = tags.find(tag => tag.name === OUTREACH_TAG);
  if (!outreachTag) return new Set();

  const subscribers = await fetchAll(apiSecret, `/tags/${outreachTag.id}/subscribers`, "subscribers");
  return new Set(subscribers.map(entry => String(entry.id)));
}

async function importFromKit(repo, createShareId, apiSecret = process.env.KIT_API_SECRET) {
  if (!apiSecret) {
    return { ok: false, reason: "no_api_key", message: "KIT_API_SECRET is not set on this server." };
  }

  const flaggedIds = await fetchFlaggedSubscriberIds(apiSecret);
  const subscribers = await fetchAll(apiSecret, "/subscribers", "subscribers");

  const summary = { ok: true, scanned: subscribers.length, imported: 0, skipped: 0, withLevels: 0, levelOnly: 0 };

  for (const subscriber of subscribers) {
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
  toImportedAssessment,
  readPLevels,
  toSqliteTimestamp,
  P_FIELD_MAP,
};
