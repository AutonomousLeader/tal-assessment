// Email manifest — the single source of truth for every email the funnel sends.
//
// Each entry maps a template key to its HTML file (in ../../emails), its
// subject line, and its preview (preheader) text. Subjects and preview text
// may contain Liquid ({{ subscriber.tal_level }}) — they are rendered with the
// same context as the body.
//
// These mirror, verbatim, the sequences that used to live in Kit. Source of
// record: _BUILD/kit-emails/KIT_SETUP_GUIDE.md

const EMAILS = {
  "deep-level-1": {
    file: "deep-level-1.html",
    subject: "Your Assessment Results — Level 1: The Grinder",
    preview: "You are the business. Every system, every decision, every problem runs through you.",
  },
  "deep-level-2": {
    file: "deep-level-2.html",
    subject: "Your Assessment Results — Level 2: The Builder",
    preview: "You are hiring. Things still break when you step away. Here is what that is costing.",
  },
  "deep-level-3": {
    file: "deep-level-3.html",
    subject: "Your Assessment Results — Level 3: The Multiplier",
    preview: "Your team is capable. Every decision still flows through you. Here is what that is costing.",
  },
  "deep-level-4": {
    file: "deep-level-4.html",
    subject: "Your Assessment Results — Level 4: The Systems Builder",
    preview: "Your team makes decisions. You still do not have a clear picture of what is actually happening.",
  },
  "deep-level-5": {
    file: "deep-level-5.html",
    subject: "Your Assessment Results — Level 5: The Coach",
    preview: "The system runs. The energy still comes from you. This is the hardest transition in the framework.",
  },
  "deep-level-6": {
    file: "deep-level-6.html",
    subject: "Your Assessment Results — Level 6: The Strategist",
    preview: "Strong team, functioning OS, capable leaders. You are still in the business more than the business needs you to be.",
  },
  "deep-level-7": {
    file: "deep-level-7.html",
    subject: "Your Assessment Results — Level 7: The Autonomous Leader",
    preview: "Your business runs without you. This is not a development plan. It is a recognition.",
  },
  "quick-results": {
    file: "quick-results.html",
    subject: "Your Quick Assessment Results — Level {{ subscriber.tal_level }}",
    preview: "Here is what your answers told me — and what the full diagnostic would reveal.",
  },
  "nurture-day-2": {
    file: "nurture-day-2.html",
    subject: "Your real bottleneck isn't what you think",
    preview: "It is not what is broken. It is what is capping everything else.",
  },
  "nurture-day-5": {
    file: "nurture-day-5.html",
    subject: "What Level {{ subscriber.tal_level }} owners miss",
    preview: "Every level has a blind spot. Here is yours.",
  },
  "nurture-day-9": {
    file: "nurture-day-9.html",
    subject: "Your business isn't one number",
    preview: "Nine pillars. Nine levels. One map.",
  },
  "nurture-day-14": {
    file: "nurture-day-14.html",
    subject: "I built a business that couldn't run without me",
    preview: "Then I learned what was actually holding it there.",
  },
  "nurture-day-30": {
    file: "nurture-day-30.html",
    subject: "What happens after Level {{ subscriber.tal_level }}",
    preview: "The transition is specific. Here is what it looks like.",
  },
  "outreach-followup": {
    file: "outreach-followup.html",
    subject: "Got your request — here is what happens next",
    preview: "I saw your results. Let's talk about what's actually holding you back.",
  },
  "quick-to-deep-upsell": {
    file: "quick-to-deep-upsell.html",
    subject: "Your quick snapshot showed Level {{ subscriber.tal_level }}. Want the full picture?",
    preview: "Five categories gave you a level. Nine pillars would give you a map.",
  },
  "90-day-retake": {
    file: "90-day-retake.html",
    subject: "It's been 90 days. Ready to measure your growth?",
    preview: "Your business has changed. Your assessment should reflect that.",
  },
};

function getEmailMeta(key) {
  return EMAILS[key] || null;
}

module.exports = { EMAILS, getEmailMeta };
