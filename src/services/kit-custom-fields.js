// Ensures all required Kit.com custom fields exist.
// Called once at server startup — idempotent.
//
// Kit.com requires custom fields to be pre-created before
// they can be populated on subscribers via the API.

const KIT_API_URL = "https://api.kit.com/v4";

const REQUIRED_FIELDS = [
  { key: "tal_first_name", label: "TAL First Name" },
  { key: "tal_level", label: "TAL Level" },
  { key: "tal_assessment_type", label: "TAL Assessment Type" },
  { key: "tal_constraint", label: "TAL Constraint" },
  { key: "tal_superpower", label: "TAL Superpower" },
  { key: "tal_pipeline_level", label: "TAL Pipeline Level" },
  { key: "tal_profit_level", label: "TAL Profit Level" },
  { key: "tal_perspective_level", label: "TAL Perspective Level" },
  { key: "tal_principles_level", label: "TAL Principles Level" },
  { key: "tal_program_level", label: "TAL Program Level" },
  { key: "tal_people_level", label: "TAL People Level" },
  { key: "tal_process_level", label: "TAL Process Level" },
  { key: "tal_progress_level", label: "TAL Progress Level" },
  { key: "tal_power_level", label: "TAL Power Level" },
];

function kitHeaders(apiSecret) {
  return {
    "Content-Type": "application/json",
    "X-Kit-Api-Key": apiSecret,
  };
}

async function fetchExistingFields(apiSecret) {
  const res = await fetch(`${KIT_API_URL}/custom_fields`, {
    method: "GET",
    headers: kitHeaders(apiSecret),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list custom fields (${res.status}): ${err}`);
  }

  const body = await res.json();
  // Kit returns { custom_fields: [{ id, key, label, ... }] }
  return body.custom_fields || [];
}

async function createField(apiSecret, label) {
  const res = await fetch(`${KIT_API_URL}/custom_fields`, {
    method: "POST",
    headers: kitHeaders(apiSecret),
    body: JSON.stringify({ label }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create custom field "${label}" (${res.status}): ${err}`);
  }

  return res.json();
}

async function ensureCustomFields(apiSecret) {
  if (!apiSecret) {
    console.log("[Kit.com] No API key — skipping custom field setup.");
    return;
  }

  try {
    const existing = await fetchExistingFields(apiSecret);
    const existingKeys = new Set(existing.map(f => f.key));

    let created = 0;
    for (const field of REQUIRED_FIELDS) {
      if (existingKeys.has(field.key)) {
        continue;
      }

      await createField(apiSecret, field.label);
      created++;
      console.log(`[Kit.com] Created custom field: ${field.label}`);
    }

    if (created === 0) {
      console.log(`[Kit.com] All ${REQUIRED_FIELDS.length} custom fields already exist.`);
    } else {
      console.log(`[Kit.com] Created ${created} new custom field(s).`);
    }
  } catch (err) {
    console.error("[Kit.com] Custom field setup failed:", err.message);
    console.error("[Kit.com] Subscriber syncs may fail until fields are created.");
  }
}

module.exports = { ensureCustomFields, REQUIRED_FIELDS };
