// The send plan — which emails fire, and when, relative to the moment an
// assessment is completed (or, for outreach, the moment the user requests it).
//
// This replaces the 12 Kit visual automations. Offsets and gating below mirror
// the LIVE automations as they were running in Kit:
//
//   Quick submission:
//     quick-results            immediately
//     quick-to-deep-upsell     +7 days   (skipped if they've since taken deep)
//     90-day-retake            +90 days
//
//   Deep submission:
//     deep-level-{N}           immediately
//     nurture-day-2 .. day-30  +2, +5, +9, +14, +30 days   (deep-takers only*)
//     90-day-retake            +90 days
//
//   Outreach requested (flag):
//     outreach-followup        +1 hour
//
// * NOTE FOR JONATHAN: the live Kit "TAL Nurture" automation was gated with a
//   "Has tal-type-deep" condition, so quick-only takers did NOT get the nurture
//   sequence. The written setup guide did not have that gate. This code matches
//   the LIVE behavior (deep-only). If you actually want quick takers nurtured
//   too, move the nurture block out of the `deep` branch below.

const DAY = 1440; // minutes
const HOUR = 60;

function deepLevelKey(level) {
  return `deep-level-${level}`;
}

// Returns the jobs to enqueue for a completed submission.
// Each job: { templateKey, offsetMinutes, condition? }
function buildSubmissionJobs({ assessmentType, levelResult }) {
  if (assessmentType === "quick") {
    return [
      { templateKey: "quick-results", offsetMinutes: 0 },
      { templateKey: "quick-to-deep-upsell", offsetMinutes: 7 * DAY, condition: "skip_if_deep" },
      { templateKey: "90-day-retake", offsetMinutes: 90 * DAY },
    ];
  }

  // deep
  return [
    { templateKey: deepLevelKey(levelResult), offsetMinutes: 0 },
    { templateKey: "nurture-day-2", offsetMinutes: 2 * DAY },
    { templateKey: "nurture-day-5", offsetMinutes: 5 * DAY },
    { templateKey: "nurture-day-9", offsetMinutes: 9 * DAY },
    { templateKey: "nurture-day-14", offsetMinutes: 14 * DAY },
    { templateKey: "nurture-day-30", offsetMinutes: 30 * DAY },
    { templateKey: "90-day-retake", offsetMinutes: 90 * DAY },
  ];
}

// The single job enqueued when a user requests outreach (PATCH /api/flag/:id).
const OUTREACH_JOB = { templateKey: "outreach-followup", offsetMinutes: 1 * HOUR };

module.exports = { buildSubmissionJobs, OUTREACH_JOB, DAY, HOUR };
