const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.NODE_ENV = "test";

const { createAdminRoutes } = require("../src/routes/admin");
const { verifySessionToken, parseCookies, COOKIE_NAME, SESSION_TTL_MS } = require("../src/services/admin-auth");
const { createLoginThrottle } = require("../src/services/login-throttle");

const ANSWERS = JSON.stringify(Array(12).fill("yes"));

const ROWS = [
  { id: 1, share_id: "aaaa1111bbbb", email: "dana@example.com", first_name: "Dana", assessment_type: "quick",
    level_result: 4, primary_constraint: null, superpower: null, total_points: 14, flagged: 0, kit_synced: 1,
    individual_answers: ANSWERS, created_at: "2026-08-19 09:00:00" },
  { id: 2, share_id: "cccc2222dddd", email: "sam@example.com", first_name: "Sam", assessment_type: "deep",
    level_result: 3, primary_constraint: "People", superpower: "Power", total_points: null, flagged: 1, kit_synced: 0,
    deep_answers: JSON.stringify(Array(18).fill("3")), created_at: "2026-08-20 09:00:00" },
];

const stubRepo = {
  listAssessments: ({ search, limit, offset }) => {
    const matched = search
      ? ROWS.filter(r => r.email.includes(search) || (r.first_name || "").includes(search))
      : ROWS;
    return matched.slice(offset, offset + limit);
  },
  countAssessments: ({ search }) => (search ? stubRepo.listAssessments({ search, limit: 999, offset: 0 }).length : ROWS.length),
  getAssessmentById: id => ROWS.find(r => r.id === id) || null,
};

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRoutes(stubRepo));
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function login(base, password = "correct-horse-battery") {
  const res = await fetch(base + "/api/admin/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
  });
  return { res, body: await res.json(), cookie: res.headers.get("set-cookie") };
}

test("the console reports whether admin access is configured", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const body = await fetch(base + "/api/admin/session").then(r => r.json());
  assert.strictEqual(body.data.adminEnabled, true);
  assert.strictEqual(body.data.authenticated, false);
});

test("assessment data is unreachable without a session", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  for (const path of ["/api/admin/assessments", "/api/admin/assessments/1"]) {
    const res = await fetch(base + path);
    assert.strictEqual(res.status, 401, `${path} was readable while signed out`);
    const body = await res.json();
    assert.ok(!JSON.stringify(body).includes("@example.com"), "data leaked in the 401 body");
  }
});

test("a wrong password is refused and sets no cookie", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { res, cookie } = await login(base, "not-the-password");
  assert.strictEqual(res.status, 401);
  assert.strictEqual(cookie, null);
});

test("the right password issues a signed, httpOnly session", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { res, cookie } = await login(base);
  assert.strictEqual(res.status, 200);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(cookie), "plain http should not get a Secure cookie");

  const token = parseCookies(cookie.split(";")[0])[COOKIE_NAME];
  assert.ok(verifySessionToken(token), "issued token does not verify");
  assert.ok(!verifySessionToken(token, Date.now() + SESSION_TTL_MS + 1000), "token never expires");
});

test("a signed-in operator sees every assessment, newest first", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { cookie } = await login(base);
  const headers = { Cookie: cookie.split(";")[0] };

  const list = await fetch(base + "/api/admin/assessments", { headers }).then(r => r.json());
  assert.strictEqual(list.data.total, 2);
  assert.strictEqual(list.data.items.length, 2);
  assert.strictEqual(list.data.items[0].email, "dana@example.com");
  assert.strictEqual(list.data.items[1].flagged, true);

  const search = await fetch(base + "/api/admin/assessments?search=sam", { headers }).then(r => r.json());
  assert.strictEqual(search.data.total, 1);
  assert.strictEqual(search.data.items[0].firstName, "Sam");
});

test("opening one assessment returns the taker's answers plus their details", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { cookie } = await login(base);
  const headers = { Cookie: cookie.split(";")[0] };

  const deep = await fetch(base + "/api/admin/assessments/2", { headers }).then(r => r.json());
  assert.strictEqual(deep.data.email, "sam@example.com");
  assert.strictEqual(deep.data.flagged, true);
  assert.strictEqual(deep.data.deepAnswers.length, 18);
  assert.match(deep.data.shareUrl, /\/r\/cccc2222dddd$/);

  const missing = await fetch(base + "/api/admin/assessments/99", { headers });
  assert.strictEqual(missing.status, 404);

  const invalid = await fetch(base + "/api/admin/assessments/abc", { headers });
  assert.strictEqual(invalid.status, 400);
});

test("a session issued over https is marked Secure", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const res = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: JSON.stringify({ password: "correct-horse-battery" }),
  });
  assert.match(res.headers.get("set-cookie"), /Secure/);
});

test("signing out invalidates the browser's cookie", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const res = await fetch(base + "/api/admin/logout", { method: "POST" });
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});

test("password guessing is throttled", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  let sawThrottle = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const { res } = await login(base, "wrong-" + attempt);
    if (res.status === 429) { sawThrottle = true; break; }
  }
  assert.ok(sawThrottle, "brute force was never slowed down");
});

test("the throttle opens back up after its window", () => {
  const throttle = createLoginThrottle({ maxAttempts: 3, windowMs: 1000 });
  const start = 1_000_000;

  for (let i = 0; i < 3; i++) throttle.recordFailure("1.2.3.4", start);
  assert.strictEqual(throttle.check("1.2.3.4", start).allowed, false);
  assert.strictEqual(throttle.check("5.6.7.8", start).allowed, true, "one address blocked another");
  assert.strictEqual(throttle.check("1.2.3.4", start + 1001).allowed, true, "lockout never lifts");

  for (let i = 0; i < 3; i++) throttle.recordFailure("9.9.9.9", start);
  throttle.reset("9.9.9.9");
  assert.strictEqual(throttle.check("9.9.9.9", start).allowed, true, "a good password did not clear the count");
});
