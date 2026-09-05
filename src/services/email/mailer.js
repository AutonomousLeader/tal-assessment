// Thin wrapper around the Resend transactional email API.
// Mirrors the Kit integration's philosophy: no-op + log when the API key is
// absent, so the app runs identically in development and during the parallel
// run before Resend is live.
//
// Auth: Authorization: Bearer RESEND_API_KEY
// Docs: https://resend.com/docs/api-reference/emails/send-email

const RESEND_API_URL = "https://api.resend.com/emails";

function isEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

// From address, e.g. "Jonathan Lauer <jonathan@mail.theautonomousleader.com>".
function fromAddress() {
  return process.env.RESEND_FROM || "The Autonomous Leader <jonathan@mail.theautonomousleader.com>";
}

// Optional Reply-To (e.g. a monitored inbox). Unset = no reply-to header.
function replyTo() {
  return process.env.RESEND_REPLY_TO || undefined;
}

// Wrap a body fragment (the Kit templates are <table> fragments) into a full,
// email-safe HTML document, with the preview text as a hidden preheader.
function wrapDocument(subject, previewText, bodyFragment) {
  const preheader = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#1C1C1C;">
${preheader}
${bodyFragment}
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]
  ));
}

// Sends one email. Returns { sent, id } or { sent:false, reason, error }.
async function sendEmail({ to, subject, html, previewText }) {
  if (!isEnabled()) {
    console.log(`[Email] RESEND_API_KEY not set — would send "${subject}" to ${to}`);
    return { sent: false, reason: "no_api_key" };
  }

  const payload = {
    from: fromAddress(),
    to: [to],
    subject,
    html: wrapDocument(subject, previewText, html),
  };
  const rt = replyTo();
  if (rt) payload.reply_to = rt;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { sent: false, reason: "error", error: `Resend ${res.status}: ${errBody.slice(0, 300)}` };
    }

    const body = await res.json();
    return { sent: true, id: body && body.id };
  } catch (err) {
    return { sent: false, reason: "error", error: err.message };
  }
}

module.exports = { sendEmail, isEnabled, wrapDocument };
