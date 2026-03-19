// Kit.com (ConvertKit) integration.
//
// When ready to activate:
// 1. Add KIT_API_SECRET to .env
// 2. Uncomment the fetch calls below
// 3. Kit API v4 docs: https://developers.kit.com/v4
//
// Flow:
// 1. Create or update subscriber with email
// 2. Add tags to the subscriber
// 3. Return sync result so the database can be updated

const KIT_API_URL = "https://api.kit.com/v4";

async function syncToKit({ email, tags, assessmentId }) {
  const apiSecret = process.env.KIT_API_SECRET;

  if (!apiSecret) {
    console.log("[Kit.com] API key not configured. Skipping sync.");
    console.log("[Kit.com] Would sync:", { email, tags, assessmentId });
    return { synced: false, reason: "no_api_key" };
  }

  try {
    // ── STEP 1: Create or update subscriber ──────────────────────────────
    // const subscriberRes = await fetch(`${KIT_API_URL}/subscribers`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "Authorization": `Bearer ${apiSecret}`,
    //   },
    //   body: JSON.stringify({
    //     email_address: email,
    //     state: "active",
    //   }),
    // });
    //
    // if (!subscriberRes.ok) {
    //   const err = await subscriberRes.text();
    //   console.error("[Kit.com] Failed to create subscriber:", err);
    //   return { synced: false, reason: "subscriber_creation_failed" };
    // }
    //
    // const subscriber = await subscriberRes.json();
    // const subscriberId = subscriber.subscriber.id;

    // ── STEP 2: Tag the subscriber ───────────────────────────────────────
    // for (const tagName of tags) {
    //   // Create or find the tag
    //   const tagRes = await fetch(`${KIT_API_URL}/tags`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       "Authorization": `Bearer ${apiSecret}`,
    //     },
    //     body: JSON.stringify({ name: tagName }),
    //   });
    //
    //   if (!tagRes.ok) {
    //     console.error(`[Kit.com] Failed to create tag "${tagName}":`, await tagRes.text());
    //     continue;
    //   }
    //
    //   const tag = await tagRes.json();
    //   const tagId = tag.tag.id;
    //
    //   // Apply tag to subscriber
    //   await fetch(`${KIT_API_URL}/tags/${tagId}/subscribers`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       "Authorization": `Bearer ${apiSecret}`,
    //     },
    //     body: JSON.stringify({ email_address: email }),
    //   });
    // }

    // ── STEP 3: Return sync result ───────────────────────────────────────
    // return { synced: true, subscriberId };

    console.log("[Kit.com] Stub mode — would create subscriber and apply tags.");
    return { synced: false, reason: "stub_mode" };
  } catch (err) {
    console.error("[Kit.com] Sync error:", err.message);
    return { synced: false, reason: "error", error: err.message };
  }
}

module.exports = { syncToKit };
