// Serves the assessment frontend with per-result link-preview tags.
//
// A share link pasted into iMessage, Slack, LinkedIn or WhatsApp is unfurled by
// a crawler that never runs JavaScript. Without this, every shared result would
// preview as the generic homepage card. The page itself is the same SPA — only
// the tags in <head> change.

const fs = require("fs");

const DEFAULT_BASE_URL = "https://assessment.theautonomousleader.com";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL;
  return configured.replace(/\/$/, "");
}

function buildShareUrl(shareId) {
  return `${getBaseUrl()}/r/${shareId}`;
}

function buildTitle(result) {
  const label = result.levelLabel || "9P Assessment Result";
  return result.firstName ? `${result.firstName}'s result: ${label}` : label;
}

function buildDescription(result) {
  const owner = result.firstName || "A business owner";

  if (result.assessmentType === "deep" && result.primaryConstraint && result.superpower) {
    return `${owner} mapped all 9 P's. Primary constraint: ${result.primaryConstraint}. Superpower: ${result.superpower}. See the full breakdown, then run your own.`;
  }

  return `${owner} ran the 7 Levels diagnostic and landed on ${result.levelLabel || "a level"}. See where they're strong, where they're stuck, then run your own.`;
}

function replaceMeta(html, attribute, name, content) {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${name}"\\s+content=")[^"]*(")`, "i");
  return html.replace(pattern, `$1${escapeHtml(content)}$2`);
}

// Keeps a page out of search results without touching anything else in <head>.
function applyNoIndex(html) {
  if (/<meta name="robots"/i.test(html)) return html;
  return html.replace(/<head>/i, '<head>\n    <meta name="robots" content="noindex, nofollow">');
}

function applyShareMeta(html, result) {
  const title = buildTitle(result);
  const description = buildDescription(result);
  const url = buildShareUrl(result.shareId);

  let output = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  output = replaceMeta(output, "name", "description", description);
  output = replaceMeta(output, "property", "og:title", title);
  output = replaceMeta(output, "property", "og:description", description);
  output = replaceMeta(output, "property", "og:url", url);
  output = replaceMeta(output, "name", "twitter:title", title);
  output = replaceMeta(output, "name", "twitter:description", description);

  // Someone else's result is not a page search engines should index.
  return applyNoIndex(output);
}

// Reads the built frontend once and keeps it in memory — every share request
// is then a string replacement, not a disk read.
function createSharePageRenderer(indexPath) {
  let cachedHtml = null;

  function loadHtml() {
    if (cachedHtml === null) {
      cachedHtml = fs.readFileSync(indexPath, "utf8");
    }
    return cachedHtml;
  }

  return function renderSharePage(result) {
    return applyShareMeta(loadHtml(), result);
  };
}

module.exports = {
  createSharePageRenderer,
  applyShareMeta,
  applyNoIndex,
  buildShareUrl,
  buildTitle,
  buildDescription,
  getBaseUrl,
};
