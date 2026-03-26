// All database read/write functions.
// This is the only file that touches SQLite directly.

function createRepository(db) {
  const insertAssessmentStmt = db.prepare(`
    INSERT INTO assessments (
      email, first_name, assessment_type, level_result, flagged,
      total_points, category_scores, individual_answers,
      p_levels, primary_constraint, superpower, deep_answers,
      tags
    ) VALUES (
      @email, @firstName, @assessmentType, @levelResult, @flagged,
      @totalPoints, @categoryScores, @individualAnswers,
      @pLevels, @primaryConstraint, @superpower, @deepAnswers,
      @tags
    )
  `);

  const flagAssessmentStmt = db.prepare("UPDATE assessments SET flagged = 1 WHERE id = ?");

  const getCounterStmt = db.prepare("SELECT count FROM counter WHERE id = 1");
  const incrementCounterStmt = db.prepare("UPDATE counter SET count = count + 1 WHERE id = 1");
  const markKitSyncedStmt = db.prepare("UPDATE assessments SET kit_synced = 1, kit_subscriber_id = ? WHERE id = ?");
  const getAssessmentByIdStmt = db.prepare("SELECT * FROM assessments WHERE id = ?");
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

  function getUnsyncedAssessments() {
    return getUnsyncedStmt.all();
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
    flagAssessment,
    getCounter,
    incrementCounter,
    markKitSynced,
    getUnsyncedAssessments,
    insertReminder,
  };
}

module.exports = { createRepository };
