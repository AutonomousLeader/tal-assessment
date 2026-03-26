// Retry queue for assessments that failed to sync to Kit.com.
//
// Runs on a setInterval — picks up records where kit_synced = 0,
// attempts to sync each one, and marks as synced on success.
// No-op if KIT_API_SECRET is not set.

const { syncToKit } = require("./kit-integration");

function parseJsonField(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function assessmentRowToSyncData(row) {
  return {
    email: row.email,
    firstName: row.first_name,
    assessmentId: row.id,
    levelResult: row.level_result,
    assessmentType: row.assessment_type,
    pLevels: parseJsonField(row.p_levels),
    primaryConstraint: row.primary_constraint,
    superpower: row.superpower,
    tags: parseJsonField(row.tags) || [],
  };
}

async function retryUnsynced(repo) {
  if (!process.env.KIT_API_SECRET) return;

  const rows = repo.getUnsyncedAssessments();
  if (rows.length === 0) return;

  console.log(`[Kit.com Retry] Found ${rows.length} unsynced assessment(s).`);

  for (const row of rows) {
    const data = assessmentRowToSyncData(row);

    const result = await syncToKit(data);

    if (result.synced && result.subscriberId) {
      repo.markKitSynced(row.id, result.subscriberId);
      console.log(`[Kit.com Retry] Synced assessment ${row.id} → subscriber ${result.subscriberId}`);
    } else {
      console.warn(`[Kit.com Retry] Failed assessment ${row.id}: ${result.reason}`);
    }
  }
}

function startRetryLoop(repo, intervalMs) {
  if (!process.env.KIT_API_SECRET) {
    console.log("[Kit.com Retry] No API key — retry loop disabled.");
    return null;
  }

  console.log(`[Kit.com Retry] Starting retry loop (every ${Math.round(intervalMs / 1000)}s).`);

  const timer = setInterval(() => {
    retryUnsynced(repo).catch(err => {
      console.error("[Kit.com Retry] Loop error:", err.message);
    });
  }, intervalMs);

  return timer;
}

module.exports = { startRetryLoop, retryUnsynced, assessmentRowToSyncData };
