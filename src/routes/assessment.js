const express = require("express");
const { buildTags } = require("../services/tag-builder");
const { syncToKit } = require("../services/kit-integration");

const router = express.Router();

// Valid P names for deep assessment validation
const P_NAMES = [
  "Pipeline", "Profit", "Perspective", "Principles", "Program",
  "People", "Process", "Progress", "Power",
];

const VALID_QUICK_ANSWERS = ["yes", "inProgress", "notYet"];
const VALID_DEEP_RANGES = ["1-2", "3", "4-5", "6-7"];

// ─── Validation helpers ─────────────────────────────────────────────────────

function validateBase(body) {
  const errors = [];

  if (!body.email || typeof body.email !== "string" || !/^.+@.+\..+$/.test(body.email)) {
    errors.push("Invalid or missing email.");
  }

  if (!["quick", "deep"].includes(body.assessmentType)) {
    errors.push("assessmentType must be 'quick' or 'deep'.");
  }

  if (!Number.isInteger(body.levelResult) || body.levelResult < 1 || body.levelResult > 7) {
    errors.push("levelResult must be an integer between 1 and 7.");
  }

  if (body.flagged !== undefined && typeof body.flagged !== "boolean") {
    errors.push("flagged must be a boolean if provided.");
  }

  return errors;
}

function validateQuick(body) {
  const errors = [];

  if (!Number.isInteger(body.totalPoints) || body.totalPoints < 0 || body.totalPoints > 24) {
    errors.push("totalPoints must be an integer between 0 and 24.");
  }

  if (!Array.isArray(body.categoryScores) || body.categoryScores.length !== 5) {
    errors.push("categoryScores must be an array of 5 items.");
  }

  if (!Array.isArray(body.individualAnswers) || body.individualAnswers.length !== 12) {
    errors.push("individualAnswers must be an array of 12 items.");
  } else if (!body.individualAnswers.every(a => VALID_QUICK_ANSWERS.includes(a))) {
    errors.push("Each individualAnswer must be 'yes', 'inProgress', or 'notYet'.");
  }

  return errors;
}

function validateDeep(body) {
  const errors = [];

  if (!body.pLevels || typeof body.pLevels !== "object") {
    errors.push("pLevels must be an object.");
  } else {
    const keys = Object.keys(body.pLevels);
    if (keys.length !== 9 || !P_NAMES.every(p => keys.includes(p))) {
      errors.push("pLevels must contain exactly 9 P keys.");
    } else if (!Object.values(body.pLevels).every(v => Number.isInteger(v) && v >= 1 && v <= 7)) {
      errors.push("Each pLevel value must be an integer between 1 and 7.");
    }
  }

  if (!body.primaryConstraint || !P_NAMES.includes(body.primaryConstraint)) {
    errors.push("primaryConstraint must be a valid P name.");
  }

  if (!body.superpower || !P_NAMES.includes(body.superpower)) {
    errors.push("superpower must be a valid P name.");
  }

  if (!Array.isArray(body.deepAnswers) || body.deepAnswers.length !== 18) {
    errors.push("deepAnswers must be an array of 18 items.");
  } else if (!body.deepAnswers.every(a => VALID_DEEP_RANGES.includes(a))) {
    errors.push("Each deepAnswer must be '1-2', '3', '4-5', or '6-7'.");
  }

  return errors;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

function createRoutes(repo) {
  // GET /api/counter
  router.get("/counter", (req, res) => {
    const count = repo.getCounter();
    res.json({ success: true, data: { count } });
  });

  // POST /api/submit
  router.post("/submit", async (req, res) => {
    const body = req.body;

    // Validate base fields
    const baseErrors = validateBase(body);
    if (baseErrors.length > 0) {
      return res.status(400).json({ success: false, errors: baseErrors });
    }

    // Validate type-specific fields
    const typeErrors = body.assessmentType === "quick"
      ? validateQuick(body)
      : validateDeep(body);

    if (typeErrors.length > 0) {
      return res.status(400).json({ success: false, errors: typeErrors });
    }

    // Flag defaults to false — user decides after seeing results
    const flagged = body.flagged ?? false;

    // Build tags for nurture sequence routing
    const tags = buildTags({
      assessmentType: body.assessmentType,
      levelResult: body.levelResult,
      flagged,
      primaryConstraint: body.primaryConstraint,
      superpower: body.superpower,
    });

    // Insert assessment record
    const assessmentId = repo.insertAssessment({
      email: body.email,
      firstName: body.firstName,
      assessmentType: body.assessmentType,
      levelResult: body.levelResult,
      flagged,
      totalPoints: body.totalPoints,
      categoryScores: body.categoryScores,
      individualAnswers: body.individualAnswers,
      pLevels: body.pLevels,
      primaryConstraint: body.primaryConstraint,
      superpower: body.superpower,
      deepAnswers: body.deepAnswers,
      tags,
    });

    // Increment the counter
    const newCount = repo.incrementCounter();

    // Sync to Kit.com (stub — logs and returns until API key is configured)
    const kitResult = await syncToKit({
      email: body.email,
      tags,
      assessmentId,
    });

    // If Kit.com sync succeeded, mark it in the database
    if (kitResult.synced && kitResult.subscriberId) {
      repo.markKitSynced(assessmentId, kitResult.subscriberId);
    }

    res.json({
      success: true,
      data: {
        id: Number(assessmentId),
        counter: newCount,
        tags,
      },
    });
  });

  // PATCH /api/flag/:id — user decided they want outreach after seeing results
  router.patch("/flag/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, errors: ["Invalid assessment ID."] });
    }

    repo.flagAssessment(id);

    // Rebuild tags with flagged = true and re-sync to Kit
    // (handled asynchronously in a future iteration when Kit is live)

    res.json({ success: true });
  });

  // POST /api/reminder — 90-day retake reminder
  router.post("/reminder", (req, res) => {
    const { email, assessmentId, remindAt } = req.body;

    if (!email || typeof email !== "string" || !/^.+@.+\..+$/.test(email)) {
      return res.status(400).json({ success: false, errors: ["Invalid email."] });
    }

    if (!remindAt || isNaN(Date.parse(remindAt))) {
      return res.status(400).json({ success: false, errors: ["Invalid remindAt date."] });
    }

    const id = repo.insertReminder({
      email,
      assessmentId: assessmentId ? Number(assessmentId) : null,
      remindAt,
    });

    res.json({ success: true, data: { id: Number(id) } });
  });

  return router;
}

module.exports = { createRoutes };
