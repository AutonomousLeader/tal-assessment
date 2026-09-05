// Enqueues the funnel emails for an event (a completed assessment, or an
// outreach request). Called from the routes. Building the jobs here keeps the
// routes thin and keeps all timing/gating decisions in plan.js.

const { buildContext } = require("./renderer");
const { buildSubmissionJobs, OUTREACH_JOB } = require("./plan");

// SQLite stores our timestamps as "YYYY-MM-DD HH:MM:SS" in UTC (matching
// datetime('now')). Convert an epoch-plus-offset to that shape.
function sqliteTimestamp(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sendAtFromNow(offsetMinutes, now = Date.now()) {
  return sqliteTimestamp(new Date(now + offsetMinutes * 60 * 1000));
}

// data: { email, firstName, assessmentType, levelResult, pLevels,
//         primaryConstraint, superpower, shareUrl, assessmentId }
function enqueueSubmissionEmails(repo, data) {
  const context = buildContext(data);
  const jobs = buildSubmissionJobs({
    assessmentType: data.assessmentType,
    levelResult: data.levelResult,
  });

  const now = Date.now();
  let enqueued = 0;
  for (const job of jobs) {
    repo.enqueueEmailJob({
      email: data.email,
      firstName: data.firstName ?? null,
      templateKey: job.templateKey,
      assessmentId: data.assessmentId ?? null,
      context,
      sendAt: sendAtFromNow(job.offsetMinutes, now),
      condition: job.condition ?? null,
    });
    enqueued++;
  }
  return enqueued;
}

// data: same shape as above (the flagged assessment row, mapped).
function enqueueOutreachEmail(repo, data) {
  const context = buildContext(data);
  repo.enqueueEmailJob({
    email: data.email,
    firstName: data.firstName ?? null,
    templateKey: OUTREACH_JOB.templateKey,
    assessmentId: data.assessmentId ?? null,
    context,
    sendAt: sendAtFromNow(OUTREACH_JOB.offsetMinutes),
    condition: null,
  });
  return 1;
}

module.exports = { enqueueSubmissionEmails, enqueueOutreachEmail, sqliteTimestamp };
