// All database read/write functions.
// This is the only file that touches SQLite directly.

function createRepository(db) {
  const insertAssessmentStmt = db.prepare(`
    INSERT INTO assessments (
      email, first_name, assessment_type, level_result, flagged,
      total_points, category_scores, individual_answers,
      p_levels, primary_constraint, superpower, deep_answers,
      share_id, source, tags, kit_synced, kit_subscriber_id, created_at
    ) VALUES (
      @email, @firstName, @assessmentType, @levelResult, @flagged,
      @totalPoints, @categoryScores, @individualAnswers,
      @pLevels, @primaryConstraint, @superpower, @deepAnswers,
      @shareId, @source, @tags, @kitSynced, @kitSubscriberId,
      COALESCE(@createdAt, datetime('now'))
    )
  `);

  const flagAssessmentStmt = db.prepare("UPDATE assessments SET flagged = 1 WHERE id = ?");

  const getCounterStmt = db.prepare("SELECT count FROM counter WHERE id = 1");
  const incrementCounterStmt = db.prepare("UPDATE counter SET count = count + 1 WHERE id = 1");
  const markKitSyncedStmt = db.prepare("UPDATE assessments SET kit_synced = 1, kit_subscriber_id = ? WHERE id = ?");
  const getAssessmentByIdStmt = db.prepare("SELECT * FROM assessments WHERE id = ?");
  const getAssessmentByShareIdStmt = db.prepare("SELECT * FROM assessments WHERE share_id = ?");
  const shareIdExistsStmt = db.prepare("SELECT 1 FROM assessments WHERE share_id = ? LIMIT 1");
  const getUnsyncedStmt = db.prepare("SELECT * FROM assessments WHERE kit_synced = 0 ORDER BY created_at ASC LIMIT 100");

  function insertAssessment(data) {
    const params = {
      email: data.email,
      firstName: data.firstName ?? null,
      assessmentType: data.assessmentType,
      levelResult: data.levelResult,
      flagged: data.flagged ? 1 : 0,
      totalPoints: data.totalPoints ?? null,
      categoryScores: data.categoryScores ? JSON.stringify(data.categoryScores) : null,
      individualAnswers: data.individualAnswers ? JSON.stringify(data.individualAnswers) : null,
      pLevels: data.pLevels ? JSON.stringify(data.pLevels) : null,
      primaryConstraint: data.primaryConstraint ?? null,
      superpower: data.superpower ?? null,
      deepAnswers: data.deepAnswers ? JSON.stringify(data.deepAnswers) : null,
      shareId: data.shareId ?? null,
      source: data.source || "assessment",
      tags: data.tags ? JSON.stringify(data.tags) : null,
      // Imported records are already in Kit, so they must not enter the retry loop.
      kitSynced: data.kitSynced ? 1 : 0,
      kitSubscriberId: data.kitSubscriberId ?? null,
      createdAt: data.createdAt ?? null,
    };

    const result = insertAssessmentStmt.run(params);
    return result.lastInsertRowid;
  }

  function getCounter() {
    const row = getCounterStmt.get();
    return row ? row.count : 421;
  }

  function incrementCounter() {
    incrementCounterStmt.run();
    return getCounter();
  }

  function markKitSynced(assessmentId, subscriberId) {
    markKitSyncedStmt.run(subscriberId, assessmentId);
  }

  function flagAssessment(assessmentId) {
    flagAssessmentStmt.run(assessmentId);
  }

  function getAssessmentById(id) {
    return getAssessmentByIdStmt.get(id) || null;
  }

  function getAssessmentByShareId(shareId) {
    return getAssessmentByShareIdStmt.get(shareId) || null;
  }

  const getByKitSubscriberStmt = db.prepare(
    "SELECT * FROM assessments WHERE kit_subscriber_id = ? AND source = 'kit-import' LIMIT 1"
  );

  // Lets the Kit import run again without duplicating anyone.
  function getImportedByKitSubscriberId(kitSubscriberId) {
    return getByKitSubscriberStmt.get(String(kitSubscriberId)) || null;
  }

  function shareIdExists(shareId) {
    return shareIdExistsStmt.get(shareId) !== undefined;
  }

  function getUnsyncedAssessments() {
    return getUnsyncedStmt.all();
  }

  // ─── Admin console listing ────────────────────────────────────────────────

  const LIST_COLUMNS = `
    id, share_id, email, first_name, assessment_type, level_result,
    primary_constraint, superpower, total_points, flagged, kit_synced,
    source, individual_answers, deep_answers, p_levels, created_at
  `;

  const SEARCH_WHERE = "WHERE email LIKE @pattern ESCAPE '\\' OR first_name LIKE @pattern ESCAPE '\\'";

  const listAllStmt = db.prepare(`
    SELECT ${LIST_COLUMNS} FROM assessments
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT @limit OFFSET @offset
  `);

  const listSearchStmt = db.prepare(`
    SELECT ${LIST_COLUMNS} FROM assessments
    ${SEARCH_WHERE}
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT @limit OFFSET @offset
  `);

  const countAllStmt = db.prepare("SELECT COUNT(*) AS total FROM assessments");
  const countSearchStmt = db.prepare(`SELECT COUNT(*) AS total FROM assessments ${SEARCH_WHERE}`);

  // % and _ are wildcards in LIKE, so a search for "a_b" must not match "axb".
  function toSearchPattern(search) {
    const escaped = search.replace(/[\\%_]/g, match => "\\" + match);
    return "%" + escaped + "%";
  }

  function listAssessments({ search, limit, offset }) {
    const params = { limit, offset };
    if (!search) return listAllStmt.all(params);
    return listSearchStmt.all({ ...params, pattern: toSearchPattern(search) });
  }

  function countAssessments({ search }) {
    if (!search) return countAllStmt.get().total;
    return countSearchStmt.get({ pattern: toSearchPattern(search) }).total;
  }

  const insertReminderStmt = db.prepare(`
    INSERT INTO reminders (email, assessment_id, remind_at)
    VALUES (@email, @assessmentId, @remindAt)
  `);

  function insertReminder(data) {
    const params = {
      email: data.email,
      assessmentId: data.assessmentId ?? null,
      remindAt: data.remindAt,
    };
    const result = insertReminderStmt.run(params);
    return result.lastInsertRowid;
  }

  // ─── Scheduled funnel emails (email_jobs) ─────────────────────────────────

  const enqueueEmailJobStmt = db.prepare(`
    INSERT INTO email_jobs (email, first_name, template_key, assessment_id, context, condition, send_at)
    VALUES (@email, @firstName, @templateKey, @assessmentId, @context, @condition, @sendAt)
  `);

  // Due = pending and its time has arrived. datetime('now') is UTC, matching
  // how send_at is stored.
  const getDueEmailJobsStmt = db.prepare(`
    SELECT * FROM email_jobs
    WHERE status = 'pending' AND send_at <= datetime('now')
    ORDER BY send_at ASC, id ASC
    LIMIT ?
  `);

  const markEmailJobSentStmt = db.prepare(`
    UPDATE email_jobs
    SET status = 'sent', provider_id = ?, sent_at = datetime('now'), attempts = attempts + 1
    WHERE id = ?
  `);

  const markEmailJobSkippedStmt = db.prepare(`
    UPDATE email_jobs SET status = 'skipped', last_error = ? WHERE id = ?
  `);

  // Bumps the attempt count; flips to 'failed' (stops retrying) once the cap
  // is reached, otherwise leaves it 'pending' for the next pass.
  const bumpEmailJobStmt = db.prepare(`
    UPDATE email_jobs
    SET attempts = attempts + 1,
        last_error = ?,
        status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
    WHERE id = ?
  `);

  const hasDeepStmt = db.prepare(
    "SELECT 1 FROM assessments WHERE email = ? AND assessment_type = 'deep' LIMIT 1"
  );

  function enqueueEmailJob(data) {
    enqueueEmailJobStmt.run({
      email: data.email,
      firstName: data.firstName ?? null,
      templateKey: data.templateKey,
      assessmentId: data.assessmentId ?? null,
      context: data.context ? JSON.stringify(data.context) : null,
      condition: data.condition ?? null,
      sendAt: data.sendAt,
    });
  }

  function getDueEmailJobs(limit = 25) {
    return getDueEmailJobsStmt.all(limit);
  }

  function markEmailJobSent(id, providerId) {
    markEmailJobSentStmt.run(providerId ?? null, id);
  }

  function markEmailJobSkipped(id, reason) {
    markEmailJobSkippedStmt.run(reason ?? null, id);
  }

  function markEmailJobFailed(id, error, maxAttempts = 5) {
    bumpEmailJobStmt.run(error ?? null, maxAttempts, id);
  }

  function hasDeepAssessmentForEmail(email) {
    return hasDeepStmt.get(email) !== undefined;
  }

  return {
    insertAssessment,
    getAssessmentById,
    getAssessmentByShareId,
    getImportedByKitSubscriberId,
    shareIdExists,
    flagAssessment,
    getCounter,
    incrementCounter,
    markKitSynced,
    getUnsyncedAssessments,
    listAssessments,
    countAssessments,
    insertReminder,
    // email_jobs
    enqueueEmailJob,
    getDueEmailJobs,
    markEmailJobSent,
    markEmailJobSkipped,
    markEmailJobFailed,
    hasDeepAssessmentForEmail,
  };
}

module.exports = { createRepository };
