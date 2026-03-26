// Kit.com (ConvertKit) API v4 integration.
//
// Handles:
// 1. Create or update subscriber with email + custom fields
// 2. Create tags (idempotent) and apply to subscriber
// 3. Return sync result for database tracking
//
// Auth: X-Kit-Api-Key header (NOT Authorization: Bearer)
// Rate limit: 120 requests per 60 seconds
// Docs: https://developers.kit.com/v4

const KIT_API_URL = "https://api.kit.com/v4";

function kitHeaders(apiSecret) {
  return {
    "Content-Type": "application/json",
    "X-Kit-Api-Key": apiSecret,
  };
}

// Build custom field values from assessment data
function buildCustomFields(data) {
  const fields = {
    tal_first_name: data.firstName || "",
    tal_level: String(data.levelResult),
    tal_assessment_type: data.assessmentType,
    tal_constraint: data.primaryConstraint || "",
    tal_superpower: data.superpower || "",
  };

  // Individual P levels (deep assessment only)
  if (data.pLevels && typeof data.pLevels === "object") {
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

    for (const [pName, fieldKey] of Object.entries(pMap)) {
      fields[fieldKey] = data.pLevels[pName] != null ? String(data.pLevels[pName]) : "";
    }
  }

  return fields;
}

// ── STEP 1: Create or update subscriber ──────────────────────────────────────

async function createOrUpdateSubscriber(apiSecret, email, firstName, customFields) {
  const res = await fetch(`${KIT_API_URL}/subscribers`, {
    method: "POST",
    headers: kitHeaders(apiSecret),
    body: JSON.stringify({
      email_address: email,
      first_name: firstName || undefined,
      state: "active",
      fields: customFields,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Subscriber creation failed (${res.status}): ${err}`);
  }

  const body = await res.json();
  return body.subscriber.id;
}

// ── STEP 2: Create tag (idempotent) and apply to subscriber ──────────────────

async function ensureTagOnSubscriber(apiSecret, tagName, email) {
  // Create tag (returns existing if name matches)
  const createRes = await fetch(`${KIT_API_URL}/tags`, {
    method: "POST",
    headers: kitHeaders(apiSecret),
    body: JSON.stringify({ name: tagName }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`[Kit.com] Failed to create tag "${tagName}" (${createRes.status}): ${err}`);
    return;
  }

  const tagBody = await createRes.json();
  const tagId = tagBody.tag.id;

  // Apply tag to subscriber by email
  const applyRes = await fetch(`${KIT_API_URL}/tags/${tagId}/subscribers`, {
    method: "POST",
    headers: kitHeaders(apiSecret),
    body: JSON.stringify({ email_address: email }),
  });

  if (!applyRes.ok) {
    const err = await applyRes.text();
    console.error(`[Kit.com] Failed to apply tag "${tagName}" (${applyRes.status}): ${err}`);
  }
}

// ── Main sync function ───────────────────────────────────────────────────────

async function syncToKit(data) {
  const apiSecret = process.env.KIT_API_SECRET;

  if (!apiSecret) {
    console.log("[Kit.com] API key not configured. Skipping sync.");
    console.log("[Kit.com] Would sync:", { email: data.email, tags: data.tags });
    return { synced: false, reason: "no_api_key" };
  }

  try {
    // Build custom field values from assessment data
    const customFields = buildCustomFields(data);

    // Step 1: Create or update subscriber with custom fields
    const subscriberId = await createOrUpdateSubscriber(
      apiSecret,
      data.email,
      data.firstName,
      customFields
    );

    console.log(`[Kit.com] Subscriber ${subscriberId} created/updated for ${data.email}`);

    // Step 2: Apply each tag
    for (const tagName of data.tags) {
      await ensureTagOnSubscriber(apiSecret, tagName, data.email);
    }

    console.log(`[Kit.com] Applied ${data.tags.length} tags to ${data.email}`);

    return { synced: true, subscriberId: String(subscriberId) };
  } catch (err) {
    console.error("[Kit.com] Sync error:", err.message);
    return { synced: false, reason: "error", error: err.message };
  }
}

module.exports = { syncToKit, buildCustomFields };
