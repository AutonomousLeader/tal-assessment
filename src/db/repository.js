// All database read/write functions.
// This is the only file that touches SQLite directly.

function createRepository(db) {
  const insertAssessmentStmt = db.prepare(`
    INSERT INTO assessments (
      email, first_name, assessment_type, level_result, flagged,
      total_points, category_scores, individual_answers,
      p_levels, primary_constraint, superpower, deep_answers,
      share_id, tags
    ) VALUES (
      @email, @firstName, @assessmentType, @levelResult, @flagged,
      @totalPoints, @categoryScores, @individualAnswers,
      @pLevels, @primaryConstraint, @superpower, @deepAnswers,
      @shareId, @tags
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
      tags: data.tags ? JSON.stringify(data.tags) : null,
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

  function shareIdExists(shareId) {
    return shareIdExistsStmt.get(shareId) !== undefined;
  }

  function getUnsyncedAssessments() {
    return getUnsyncedStmt.all();
  }

  // ─── Admin console listing ────────────────────────────────────────────────

  const LIST_COLUMNS = `
    id, share_id, email, first_name, assessment_type, level_result,
    primary_constraint, superpower, total_points, flagged, kit_synced, created_at
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

  return {
    insertAssessment,
    getAssessmentById,
    getAssessmentByShareId,
    shareIdExists,
    flagAssessment,
    getCounter,
    incrementCounter,
    markKitSynced,
    getUnsyncedAssessments,
    listAssessments,
    countAssessments,
    insertReminder,
  };
}

module.exports = { createRepository };
