// Renders an email template (body fragment, subject, preview) against a
// subscriber context using Liquid — the same template language Kit used, so the
// existing templates render unchanged: {{ subscriber.first_name }},
// {{ subscriber.tal_constraint | default: "your primary constraint" }},
// {% if subscriber.tal_level == "4" %}...{% endif %}, {% if x != blank %}, etc.

const fs = require("fs");
const path = require("path");
const { Liquid } = require("liquidjs");

const EMAILS_DIR = path.join(__dirname, "../../emails");

const engine = new Liquid({
  strictFilters: false,
  strictVariables: false, // a missing field renders empty, never throws
});

// Cache compiled templates so we parse each file once.
const templateCache = new Map();

function loadTemplate(file) {
  if (templateCache.has(file)) return templateCache.get(file);
  const html = fs.readFileSync(path.join(EMAILS_DIR, file), "utf8");
  templateCache.set(file, html);
  return html;
}

async function renderString(str, context) {
  if (!str) return "";
  return engine.parseAndRender(str, context);
}

// Builds the Liquid context from an assessment-shaped object. Templates read
// everything under `subscriber.*`, so we mirror the field names the Kit
// integration used (tal_level as a string, tal_constraint as a P name, etc.).
function buildContext(data) {
  const subscriber = {
    first_name: data.firstName || "",
    tal_level: data.levelResult != null ? String(data.levelResult) : "",
    tal_constraint: data.primaryConstraint || "",
    tal_superpower: data.superpower || "",
    tal_result_link: data.shareUrl || "",
  };

  const pMap = {
    Pipeline: "tal_pipeline_level",
    Profit: "tal_profit_level",
    Perspective: "tal_perspective_level",
    Principles: "tal_principles_level",
    Program: "tal_program_level",
    People: "tal_people_level",
    Process: "tal_process_level",
    Progress: "tal_progress_level",
    Power: "tal_power_level",
  };

  const pLevels = data.pLevels || {};
  for (const [pName, fieldKey] of Object.entries(pMap)) {
    subscriber[fieldKey] = pLevels[pName] != null ? String(pLevels[pName]) : "";
  }

  return { subscriber };
}

// Renders body + subject + preview for a manifest entry against a context.
async function renderEmail(meta, context) {
  const [body, subject, preview] = await Promise.all([
    renderString(loadTemplate(meta.file), context),
    renderString(meta.subject, context),
    renderString(meta.preview, context),
  ]);
  return { body, subject, preview };
}

module.exports = { renderEmail, buildContext, renderString };
