// Converts a stored assessment row into the payload a share link may expose.
//
// A share link can be forwarded to anyone, so this is the privacy boundary:
// email, Kit.com tags/subscriber ids and the outreach flag never leave here.
// Only the answers are returned — the browser recomputes the same result from
// them, so the shared page and the original page always agree.

const LEVEL_LABELS = {
  1: "Level 1 — The Grinder",
  2: "Level 2 — The Builder",
  3: "Level 3 — The Multiplier",
  4: "Level 4 — The Systems Builder",
  5: "Level 5 — The Coach",
  6: "Level 6 — The Strategist",
  7: "Level 7 — The Autonomous Leader",
};

const QUICK_ANSWER_COUNT = 12;
const DEEP_ANSWER_COUNT = 18;

const P_NAMES = [
  "Pipeline", "Profit", "Perspective", "Principles", "Program",
  "People", "Process", "Progress", "Power",
];

function parseJsonArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

// Records imported from Kit have no answers to replay, but they do carry a
// level for each of the nine P's, which is everything the profile draws.
function parsePLevels(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const valid = P_NAMES.every(pName => {
      const level = parsed[pName];
      return Number.isInteger(level) && level >= 1 && level <= 7;
    });
    if (!valid) return null;
    return Object.fromEntries(P_NAMES.map(pName => [pName, parsed[pName]]));
  } catch (err) {
    return null;
  }
}

function readPName(value) {
  if (typeof value !== "string") return null;
  return P_NAMES.find(pName => pName === value) || null;
}

// `detail` tells the page how much of the result survived:
//   "full"       every answer is stored, so the whole page redraws
//   "levels"     the nine P levels survived, so the profile redraws
//   "level-only" only the overall level survived
//
// Returns null when there is no viewable result at all — the caller turns that
// into a 404 rather than rendering a half-empty page.
function toPublicResult(row) {
  if (!row || !row.share_id) return null;
  if (!Number.isInteger(row.level_result) || row.level_result < 1 || row.level_result > 7) return null;

  const base = {
    shareId: row.share_id,
    assessmentType: row.assessment_type,
    firstName: row.first_name || null,
    levelResult: row.level_result,
    levelLabel: LEVEL_LABELS[row.level_result] || null,
    source: row.source || "assessment",
    createdAt: row.created_at,
  };

  if (row.assessment_type === "quick") {
    const individualAnswers = parseJsonArray(row.individual_answers);
    if (individualAnswers && individualAnswers.length === QUICK_ANSWER_COUNT) {
      return { ...base, detail: "full", individualAnswers };
    }
    return { ...base, detail: "level-only" };
  }

  if (row.assessment_type === "deep") {
    const primaryConstraint = readPName(row.primary_constraint);
    const superpower = readPName(row.superpower);

    const deepAnswers = parseJsonArray(row.deep_answers);
    if (deepAnswers && deepAnswers.length === DEEP_ANSWER_COUNT) {
      return { ...base, detail: "full", deepAnswers, primaryConstraint, superpower };
    }

    const pLevels = parsePLevels(row.p_levels);
    if (pLevels) {
      return { ...base, detail: "levels", pLevels, primaryConstraint, superpower };
    }

    return { ...base, detail: "level-only", primaryConstraint, superpower };
  }

  return null;
}

module.exports = { toPublicResult, LEVEL_LABELS };
