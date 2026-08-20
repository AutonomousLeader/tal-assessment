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

function parseJsonArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

// Returns null when the row cannot produce a viewable result — the caller
// turns that into a 404 rather than rendering a half-empty page.
function toPublicResult(row) {
  if (!row || !row.share_id) return null;

  const base = {
    shareId: row.share_id,
    assessmentType: row.assessment_type,
    firstName: row.first_name || null,
    levelResult: row.level_result,
    levelLabel: LEVEL_LABELS[row.level_result] || null,
    createdAt: row.created_at,
  };

  if (row.assessment_type === "quick") {
    const individualAnswers = parseJsonArray(row.individual_answers);
    if (!individualAnswers || individualAnswers.length !== QUICK_ANSWER_COUNT) return null;
    return { ...base, individualAnswers };
  }

  if (row.assessment_type === "deep") {
    const deepAnswers = parseJsonArray(row.deep_answers);
    if (!deepAnswers || deepAnswers.length !== DEEP_ANSWER_COUNT) return null;
    return {
      ...base,
      deepAnswers,
      primaryConstraint: row.primary_constraint || null,
      superpower: row.superpower || null,
    };
  }

  return null;
}

module.exports = { toPublicResult, LEVEL_LABELS };
