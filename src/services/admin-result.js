// The record behind the admin console.
//
// This is the same result the person who took the assessment saw, plus the
// details only the operator needs: who they are, when they took it, and whether
// they asked to be contacted.

const { toPublicResult } = require("./public-result");
const { buildShareUrl } = require("./share-page");

function toAdminResult(row) {
  const result = toPublicResult(row);
  if (!result) return null;

  return {
    ...result,
    id: row.id,
    email: row.email,
    flagged: Boolean(row.flagged),
    kitSynced: Boolean(row.kit_synced),
    shareUrl: buildShareUrl(row.share_id),
  };
}

function toAdminListItem(row) {
  return {
    id: row.id,
    shareId: row.share_id,
    email: row.email,
    firstName: row.first_name || null,
    assessmentType: row.assessment_type,
    levelResult: row.level_result,
    primaryConstraint: row.primary_constraint || null,
    superpower: row.superpower || null,
    flagged: Boolean(row.flagged),
    createdAt: row.created_at,
  };
}

module.exports = { toAdminResult, toAdminListItem };
