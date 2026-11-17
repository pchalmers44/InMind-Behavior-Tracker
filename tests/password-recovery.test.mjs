import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function evaluate(source, globals = {}, imports = {}) {
  const context = { exports: {}, setTimeout, clearTimeout, URL, URLSearchParams,
    Headers, AbortController, console: { warn() {} },
    require: (name) => { if (!(name in imports)) throw new Error("Unexpected import: " + name); return imports[name]; }, ...globals };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, context);
  return context;
}
const reliability = evaluate(fs.readFileSync("src/lib/reliability.ts", "utf8")).exports;
const recoveryModule = evaluate(fs.readFileSync("src/lib/password-recovery.ts", "utf8")).exports;
const session = (id = "synthetic-user", token = "synthetic-token") => ({
  user: { id, email: "synthetic@example.invalid" }, access_token: token, expires_at: Date.now() / 1000 + 600,
});
const callback = "https://inmindobservation.com/change-password?recovery=1#type=recovery&access_token=synthetic-token&refresh_token=synthetic-refresh&expires_in=600&token_type=bearer";
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
function tracker(href, initialization = Promise.resolve({ error: null })) {
  let listener;
  const recovery = recoveryModule.createPasswordRecovery({ auth: {
    onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    initialize: () => initialization,
  } }, href);
  return { recovery, emit: (event, value) => listener(event, value) };
}

test("production recovery redirect matches the required allowlist URL", () => {
  assert.equal(recoveryModule.recoveryRedirect("https://inmindobservation.com"), "https://inmindobservation.com/change-password?recovery=1");
  assert.equal(recoveryModule.recoveryRedirect("http://localhost:3000"), "http://localhost:3000/change-password?recovery=1");
});

test("recovery proof is captured before any page subscribes and binds the recovered identity", () => {
  const { recovery, emit } = tracker(callback);
  assert.equal(recovery.getSnapshot().status, "pending");
  assert.equal(recovery.isAuthorized(session()), false);
  emit("PASSWORD_RECOVERY", session());
  assert.equal(recovery.getSnapshot().status, "ready");
  assert.equal(recovery.isAuthorized(session()), true);
  assert.equal(recovery.isAuthorized(session("different-user")), false);
  assert.equal(recovery.isAuthorized(session("synthetic-user", "different-token")), false);
  assert.equal(recovery.isAuthorized({ ...session(), expires_at: 1 }), false);
  assert(!JSON.stringify(recovery.getSnapshot()).includes("synthetic-token"));
  recovery.dispose();
});

test("query flag, malformed links, PKCE codes, and unverified token hashes never authorize recovery", () => {
  for (const href of [
    "https://inmindobservation.com/change-password?recovery=1",
    "https://inmindobservation.com/change-password?recovery=1#access_token=synthetic",
    "https://inmindobservation.com/change-password?recovery=1#error_code=otp_expired&error_description=synthetic",
    "https://inmindobservation.com/change-password?code=synthetic",
    "https://inmindobservation.com/change-password?type=recovery&token_hash=synthetic",
  ]) {
    const { recovery, emit } = tracker(href);
    emit("INITIAL_SESSION", session("unrelated-user"));
    assert.equal(recovery.getSnapshot().status, "invalid");
    assert.equal(recovery.isAuthorized(session("unrelated-user")), false);
    recovery.dispose();
  }
});

test("SDK callback failure or an initial stale session cannot establish recovery", async () => {
  const { recovery, emit } = tracker(callback, Promise.resolve({ error: { code: "otp_expired" } }));
  emit("INITIAL_SESSION", session("unrelated-user"));
  await settle();
  assert.equal(recovery.getSnapshot().status, "invalid");
  assert.equal(recovery.isAuthorized(session("unrelated-user")), false);
  recovery.dispose();
});

test("recovery can refresh its own session but rejects a different login and clears proof on completion", () => {
  const { recovery, emit } = tracker(callback);
  emit("PASSWORD_RECOVERY", session());
  emit("TOKEN_REFRESHED", session("synthetic-user", "synthetic-refreshed"));
  assert.equal(recovery.isAuthorized(session("synthetic-user", "synthetic-refreshed")), true);
  emit("SIGNED_IN", session("other-user"));
  assert.equal(recovery.getSnapshot().status, "invalid");
  emit("PASSWORD_RECOVERY", session());
  recovery.finish();
  assert.equal(recovery.getSnapshot().status, "complete");
  assert.equal(recovery.getSnapshot().userId, null);
  assert.equal(recovery.isAuthorized(session()), false);
  emit("SIGNED_OUT", null);
  assert.equal(recovery.getSnapshot().status, "complete");
  recovery.reset(); assert.equal(recovery.getSnapshot().status, "idle");
  recovery.dispose();
});

function declaration(file, component, name) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === component);
  return fn.body.statements.find((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((item) => item.name.getText(ast) === name)).getText(ast);
}
function requestHarness(response, deadline = reliability.withDeadline) {
  const state = {}; const calls = [];
  const c = evaluate(declaration("src/app/login/page.tsx", "LoginPage", "handleForgotPassword") + "\nglobalThis.request = handleForgotPassword;", {
    email: "  synthetic@example.invalid  ", isResettingRef: { current: false },
    window: { location: { origin: "https://inmindobservation.com" } },
    ...reliability, recoveryRedirect: recoveryModule.recoveryRedirect, withDeadline: deadline,
    setIsResetting: (x) => { state.loading = x; }, setError: (x) => { state.error = x; }, setMessage: (x) => { state.message = x; },
    supabase: { auth: { resetPasswordForEmail: async (...args) => { calls.push(args); return response(); } } },
  });
  return { ...c, state, calls };
}

test("reset requests trim the email, preserve redirect, and do not claim delivery or account existence", async () => {
  const h = requestHarness(() => ({ error: null }));
  await h.request();
  assert.equal(h.calls[0][0], "synthetic@example.invalid");
  assert.equal(h.calls[0][1].redirectTo, "https://inmindobservation.com/change-password?recovery=1");
  assert.match(h.state.message, /If an account exists/);
  assert(!h.state.message.includes("email sent"));
  assert.equal(h.state.loading, false);
  await h.request(); assert.equal(h.calls.length, 2);
});

test("reset failures and stalled requests release loading and permit a new request", async () => {
  for (const response of [
    () => ({ error: { status: 400, message: "synthetic account does not exist" } }),
    () => ({ error: { status: 429 } }),
    () => { throw new Error("synthetic"); },
    () => new Promise(() => {}),
  ]) {
    const h = requestHarness(response, (work) => reliability.withDeadline(work, undefined, 5));
    await h.request();
    assert.equal(h.state.loading, false); assert(h.state.error);
    assert(!h.state.error.includes("does not exist"));
    await h.request(); assert.equal(h.calls.length, 2);
  }
});

test("double-click Forgot Password sends only one simultaneous request", async () => {
  let finish;
  const h = requestHarness(() => new Promise((resolve) => { finish = resolve; }));
  const first = h.request(); const second = h.request();
  assert.equal(h.calls.length, 1); finish({ error: null }); await Promise.all([first, second]);
  assert.equal(h.state.loading, false);
});

test("sign-in after recovery clears recovery context and submits the new password", async () => {
  const calls = []; const state = {};
  const c = evaluate(declaration("src/app/login/page.tsx", "LoginPage", "handleSubmit") + "\nglobalThis.login = handleSubmit;", {
    ...reliability, email: " synthetic@example.invalid ", password: "synthetic-new",
    isSubmittingRef: { current: false }, isRecoveryRef: { current: true },
    setIsSubmitting: (x) => { state.loading = x; }, setError: (x) => { state.error = x; }, setMessage() {},
    passwordRecovery: { reset: () => calls.push("reset-context") },
    router: { replace: (x) => calls.push(x), refresh() {} },
    supabase: { auth: {
      signOut: async () => { calls.push("signout"); return { error: null }; },
      signInWithPassword: async (credentials) => {
        assert.equal(credentials.email, "synthetic@example.invalid");
        assert.equal(credentials.password, "synthetic-new");
        calls.push("signin"); return { error: null, data: { session: session() } };
      },
      getUser: async () => ({ error: null, data: { user: session().user } }),
    } },
  });
  await c.login({ preventDefault() {} });
  assert.deepEqual(calls, ["signout", "reset-context", "signin", "/"]);
  assert.equal(state.loading, false); assert.equal(state.error, "");
});

function updateHarness({ recovery = true, fresh = session(), result, update, authorized = true } = {}) {
  const state = {}; const calls = []; const routes = [];
  const c = evaluate(declaration("src/app/change-password/page.tsx", "ChangePasswordPage", "handleSubmit") + "\nglobalThis.update = handleSubmit;", {
    ...reliability, submitting: { current: false }, wantsRecovery: recovery, isRecovery: recovery && authorized,
    user: session().user, session: session(), email: session().user.email,
    currentPassword: recovery ? "" : "synthetic-old", newPassword: "synthetic-new", confirmPassword: "synthetic-new",
    setError: (x) => { state.error = x; }, setMessage: (x) => { state.message = x; },
    setIsSubmitting: (x) => { state.loading = x; }, setCompleted: (x) => { state.completed = x; },
    setCurrentPassword() {}, setNewPassword() {}, setConfirmPassword() {},
    router: { replace: (x) => routes.push(x) },
    passwordRecovery: { isAuthorized: () => authorized, finish: () => { state.proofCleared = true; } },
    passwordUpdates: { run: (session, work) => { calls.push(["bound-session", session.user.id]); return reliability.withDeadline(work(), undefined, 5); } },
    supabase: { auth: {
      signInWithPassword: async () => { calls.push(["reauthenticate"]); return { error: null, data: { user: session().user } }; },
      getSession: async () => ({ error: null, data: { session: fresh } }),
      getUser: async () => ({ error: null, data: { user: fresh?.user } }),
      updateUser: async (body) => { calls.push(["update", body]); return update ? update() : result || { error: null, data: { user: session().user } }; },
      signOut: async (options) => { calls.push(["signout", options]); return { error: null }; },
    } },
  });
  return { c, state, calls, routes, update: () => c.update({ preventDefault() {} }) };
}

test("successful recovery updates the recovered account, clears proof, and returns to sign in", async () => {
  const h = updateHarness(); await h.update();
  assert.equal(h.calls.filter(([method]) => method === "update").length, 1);
  assert.equal(h.calls.filter(([method]) => method === "reauthenticate").length, 0);
  assert.equal(h.state.completed, true); assert.equal(h.state.proofCleared, true);
  assert.equal(h.calls.find(([method]) => method === "signout")[1].scope, "local");
  assert.deepEqual(h.routes, ["/login"]); assert.equal(h.state.loading, false);
});

test("normal password change still verifies the current password and stays signed in", async () => {
  const h = updateHarness({ recovery: false }); await h.update();
  assert(h.calls.some(([method]) => method === "reauthenticate"));
  assert(h.calls.some(([method]) => method === "update"));
  assert(!h.calls.some(([method]) => method === "signout"));
  assert.equal(h.state.proofCleared, undefined);
  assert.match(h.state.message, /successfully/);
});

test("unverified recovery flag, mismatched confirmation, and switched identity prevent updates", async () => {
  const invalid = updateHarness({ authorized: false }); await invalid.update();
  assert.equal(invalid.calls.length, 0); assert.match(invalid.state.error, /not verified/);
  const mismatch = updateHarness(); mismatch.c.confirmPassword = "synthetic-other"; await mismatch.update();
  assert.equal(mismatch.calls.length, 0); assert.match(mismatch.state.error, /do not match/);
  const switched = updateHarness({ fresh: session("other-user") }); await switched.update();
  assert(!switched.calls.some(([method]) => method === "update"));
  assert.equal(switched.state.loading, false);
});

test("the rendered recovery page hides password fields for an invalid link and unrelated session", () => {
  function render(status, authorized, flag) {
    const current = session(status === "invalid" ? "unrelated-user" : "synthetic-user");
    const imports = {
      "react/jsx-runtime": jsxRuntime,
      "react": { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] },
      "next/link": { default: ({ href, children }) => jsxRuntime.jsx("a", { href, children }) },
      "next/navigation": { useRouter: () => ({ replace() {} }), useSearchParams: () => ({ get: () => flag ? "1" : null }) },
      "@/components/auth/AuthProvider": { useAuth: () => ({ user: current.user, session: current,
        recovery: { status, userId: "synthetic-user" }, retryVerification() {} }) },
      "@/lib/supabase": { passwordRecovery: { isAuthorized: () => authorized } },
      "@/lib/reliability": reliability,
    };
    const component = evaluate(fs.readFileSync("src/app/change-password/page.tsx", "utf8"), {}, imports).exports.default;
    return renderToStaticMarkup(component());
  }
  const invalid = render("invalid", false, true);
  assert(!invalid.includes('type="password"'));
  assert.match(invalid, /expired, invalid/);
  assert(!invalid.includes("synthetic-token"));
  const pending = render("pending", false, true);
  assert(!pending.includes('type="password"')); assert.match(pending, /Verifying/);
  const verified = render("ready", true, true);
  assert(verified.includes('id="new-password"')); assert(!verified.includes('id="current-password"'));
  const normal = render("idle", false, false);
  assert(normal.includes('id="current-password"')); assert(normal.includes('id="new-password"'));
});

test("password policy errors, rejected updates, and update timeouts recover the form", async () => {
  for (const options of [
    { result: { error: { code: "weak_password", message: "Synthetic policy requires a stronger password" } } },
    { update: () => { throw new Error("synthetic"); } },
    { update: () => new Promise(() => {}) },
  ]) {
    const h = updateHarness(options); await h.update();
    assert.equal(h.state.loading, false); assert.equal(h.c.submitting.current, false);
    assert(h.state.error); assert.equal(h.state.proofCleared, undefined);
    if (options.result) assert.match(h.state.error, /stronger password/);
  }
});

test("overlapping password updates are blocked synchronously", async () => {
  let finish;
  const h = updateHarness({ update: () => new Promise((resolve) => { finish = resolve; }) });
  const first = h.update(); const second = h.update(); await new Promise(setImmediate);
  assert.equal(h.calls.filter(([method]) => method === "update").length, 1);
  finish({ error: null, data: { user: session().user } }); await Promise.all([first, second]);
});

function passwordGuard(deadline = reliability.withDeadline) {
  const requests = [];
  const loaded = evaluate(fs.readFileSync("src/lib/password-update.ts", "utf8"), {
    fetch: async (...args) => { requests.push(args); return { ok: true }; },
  }, { "./reliability": { withDeadline: deadline } }).exports;
  return { guard: loaded.createPasswordUpdates("https://synthetic.supabase.invalid"), requests };
}
const passwordRequest = (token) => ({ method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: "synthetic-new" }) });
const endpoint = "https://synthetic.supabase.invalid/auth/v1/user";

test("transport guard rejects a late identity switch before any password write leaves the browser", async () => {
  const { guard, requests } = passwordGuard();
  await assert.rejects(guard.run(session(), () => guard.fetch(endpoint, passwordRequest("other-token"))), { name: "PasswordSessionError" });
  assert.equal(requests.length, 0);
  await guard.run(session(), () => guard.fetch(endpoint, passwordRequest("synthetic-token")));
  assert.equal(requests.length, 1);
  await assert.rejects(guard.fetch(endpoint, passwordRequest("synthetic-token")), { name: "PasswordSessionError" });
});

test("password guard leaves observation and ordinary auth requests unchanged", async () => {
  const { guard, requests } = passwordGuard();
  const options = { method: "POST", body: JSON.stringify({ behaviors: [] }) };
  await guard.fetch("https://synthetic.supabase.invalid/rest/v1/visits", options);
  await guard.fetch("https://synthetic.supabase.invalid/auth/v1/token", { method: "POST" });
  assert.equal(requests[0][1], options); assert.equal(requests.length, 2);
});

test("timed-out SDK writes cannot send late or overlap a new password operation", async () => {
  const { guard, requests } = passwordGuard((work, abort) => reliability.withDeadline(work, abort, 5));
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const old = guard.run(session(), async () => { await wait; return guard.fetch(endpoint, passwordRequest("synthetic-token")); });
  await assert.rejects(old, { name: "TimeoutError" });
  await assert.rejects(guard.run(session(), async () => ({ ok: true })), { name: "PasswordPendingError" });
  release(); await settle(); assert.equal(requests.length, 0);
  await guard.run(session(), () => guard.fetch(endpoint, passwordRequest("synthetic-token")));
  assert.equal(requests.length, 1);
});

test("installed SDK establishes an implicit recovery session and performs a bound password update", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const location = new URL(callback);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location, addEventListener() {}, removeEventListener() {},
    history: { state: null, replaceState(_state, _title, href) { location.href = href; } },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible" } });
  const requests = [];
  const user = session().user;
  const updates = evaluate(fs.readFileSync("src/lib/password-update.ts", "utf8"), {
    fetch: async (input, init) => {
      requests.push({ path: new URL(input).pathname, method: init.method });
      return new Response(JSON.stringify(user), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  }, { "./reliability": reliability }).exports.createPasswordUpdates("https://synthetic.supabase.invalid");
  const client = createClient("https://synthetic.supabase.invalid", "synthetic-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
    global: { fetch: updates.fetch },
  });
  const recovery = recoveryModule.createPasswordRecovery(client, location.href);
  try {
    const initialized = await client.auth.initialize();
    assert.equal(initialized.error, null);
    await settle();
    const current = await client.auth.getSession();
    assert.equal(recovery.getSnapshot().status, "ready");
    assert.equal(recovery.isAuthorized(current.data.session), true);
    assert.equal(location.hash, "");
    const updated = await updates.run(current.data.session, () => client.auth.updateUser({ password: "synthetic-new" }));
    assert.equal(updated.error, null);
    assert.equal(updated.data.user.id, user.id);
    assert.equal(requests.filter((request) => request.method === "PUT").length, 1);
  } finally {
    recovery.dispose();
    client.auth.stopAutoRefresh();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else delete globalThis.window;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else delete globalThis.document;
  }
});
