import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function evaluate(source, globals = {}) {
  const context = { exports: {}, setTimeout, clearTimeout, AbortController, console, ...globals };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context;
}
const helpers = evaluate(fs.readFileSync("src/lib/reliability.ts", "utf8"), {
  console: { warn() {} },
}).exports;
const page = fs.readFileSync("src/app/page.tsx", "utf8");

// Exercise the real handlers, with synthetic state and a mock transport only.
function declaration(source, component, name) {
  const ast = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === component);
  return fn.body.statements.find((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((item) => item.name.getText(ast) === name)).getText(ast);
}
const saveSource = declaration(page, "PageInner", "completeVisit");
const startSource = declaration(page, "PageInner", "startVisit");
const synthetic = (type = "student") => ({
  id: "synthetic-id", type, subjectName: "synthetic", observerName: "synthetic", grade: "Grade 9",
  district: "synthetic", schoolName: "synthetic", startTime: 1000, endTime: 2000,
  totalDuration: 1, isFirstVisit: true, behaviors: [{ id: "synthetic-behavior", count: 2, durationSec: 1 }],
  abcEntries: [{ antecedent: "synthetic", behavior: "synthetic", consequence: "synthetic" }],
  fbaLatencyEvents: [], fbaIntervalSessions: [],
});

function harness({ editing = false, writes = [], reads = [] } = {}) {
  const requests = [];
  const state = { data: { visits: [], subjects: [] }, active: synthetic(), saving: false, toast: null };
  const client = { from(table) {
    const request = { table, method: "read", filters: [] };
    const query = {
      insert(rows) { request.method = "insert"; request.payload = rows[0]; return query; },
      update(payload) { request.method = "update"; request.payload = payload; return query; },
      eq(key, value) { request.filters.push([key, value]); return query; },
      select() { return query; }, abortSignal() { return query; },
      then(resolve, reject) {
        requests.push(request);
        const response = (request.method === "read" ? reads : writes).shift();
        const result = typeof response === "function" ? response(request) : response;
        return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result || {
          error: null, status: 200,
          data: request.method === "read" ? [] : [{ id: "synthetic-id", ...request.payload }],
        })).then(resolve, reject);
      },
    };
    return query;
  } };
  const context = evaluate(saveSource + "\nglobalThis.save = completeVisit;", {
    ...helpers, user: { id: "synthetic-user" }, editingVisitId: editing ? "synthetic-id" : null,
    canManageAllObservations: false, supabase: client,
    saveInFlight: { current: false }, pendingWrite: { current: null }, pendingSnapshot: { current: null },
    historyGeneration: { current: 0 },
    setIsSaving: (value) => { state.saving = value; },
    setSaveUnconfirmed: (value) => { state.unconfirmed = value; },
    setSaveToast: (value) => { state.toast = value; },
    setHistoryLoading() {},
    setData: (value) => { state.data = typeof value === "function" ? value(state.data) : value; },
    setActiveVisit: (value) => { state.active = value; },
    setEditingVisitId() {}, setScreen() {}, setTab() {}, setNewVisitForm() {},
    setObservationSelectionCard() {}, setImplementationStatus() {}, router: { push() {} },
  });
  return { context, state, requests, save: context.save };
}

test("session errors distinguish network/service failures from invalid sessions", () => {
  for (const failure of [new TypeError("synthetic"), { status: 503 }, { status: 403, code: "unexpected_failure" }]) {
    assert.equal(helpers.invalidSession(failure), false);
  }
  assert.equal(helpers.invalidSession({ status: 401 }), true);
  assert.equal(helpers.invalidSession({ code: "session_not_found" }), true);
});

test("deadline rejects and aborts stalled requests", async () => {
  let aborted = false;
  await assert.rejects(helpers.withDeadline(new Promise(() => {}), () => { aborted = true; }, 5), { name: "TimeoutError" });
  assert.equal(aborted, true);
});

test("failed INSERT/UPDATE preserve work, release guard, and allow successful retry", async () => {
  for (const editing of [false, true]) {
    const h = harness({ editing, writes: [{ status: 403, error: { code: "42501" }, data: null }] });
    await h.save(synthetic());
    assert(h.state.active);
    assert.equal(h.state.saving, false);
    assert.equal(h.context.saveInFlight.current, false);
    assert.equal(h.state.unconfirmed, false);
    assert.match(h.state.toast.message, /denied/);
    await h.save(synthetic());
    assert.equal(h.state.active, null);
    assert.equal(h.state.toast, null);
    assert.equal(h.state.data.visits.length, 1);
  }
});

test("missing authentication has an actionable error and no write", async () => {
  const h = harness(); h.context.user = null;
  await h.save(synthetic());
  assert.match(h.state.toast.message, /session/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.state.saving, false);
  assert(h.state.active);
});

test("double-click Save issues one write", async () => {
  let finish;
  const h = harness({ writes: [(request) => new Promise((resolve) => {
    finish = () => resolve({ error: null, status: 201, data: [{ id: "synthetic-id", ...request.payload }] });
  })] });
  const first = h.save(synthetic());
  const second = h.save(synthetic());
  await new Promise(setImmediate);
  assert.equal(h.state.saving, true);
  assert.equal(h.requests.length, 1);
  finish(); await Promise.all([first, second]);
  assert.equal(h.state.data.visits.length, 1);
});

test("ambiguous INSERT/UPDATE reconcile the entire submitted payload", async () => {
  for (const editing of [false, true]) {
    let submitted;
    const h = harness({ editing,
      writes: [(request) => { submitted = request.payload; return { error: { code: "", message: "synthetic" }, status: 0, data: null }; }],
      reads: [() => ({ error: null, status: 200, data: [{ id: "synthetic-id", ...submitted }] })],
    });
    await h.save(synthetic("fba"));
    assert.equal(h.state.active, null);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].method, "read");
    assert(h.requests[1].filters.some(([key]) => key === "created_by"));
  }
});

test("unknown outcomes retain snapshot and ID; recovery only reads, never blindly retries", async () => {
  for (const editing of [false, true]) {
    const h = harness({ editing, writes: [new TypeError("synthetic interruption")] });
    await h.save(synthetic("fba"));
    assert(h.state.active);
    assert.equal(h.state.unconfirmed, true);
    assert.equal(h.state.saving, false);
    const write = h.context.pendingWrite.current;
    const snapshot = h.context.pendingSnapshot.current;
    await h.save(snapshot);
    assert.equal(h.requests.filter((r) => r.method !== "read").length, 1);
    assert.equal(h.context.pendingWrite.current.id, "synthetic-id");
    // Reconciliation becomes available after connectivity returns.
    h.context.reconcileVisit = async (_client, pending) => {
      assert.equal(pending, write); return true;
    };
    await h.save(snapshot);
    assert.equal(h.state.active, null);
    assert.equal(h.state.toast, null);
  }
});

test("empty returned rows never alone confirm INSERT or UPDATE", async () => {
  for (const editing of [false, true]) {
    const h = harness({ editing, writes: [{ error: null, status: 200, data: [] }] });
    await h.save(synthetic());
    assert(h.state.active);
    assert.equal(h.state.unconfirmed, true);
    assert.match(h.state.toast.message, /unconfirmed/);
  }
});

test("FBA missing-column errors do not retry a reduced payload", async () => {
  for (const editing of [false, true]) {
    const h = harness({ editing, writes: [{ error: { code: "PGRST204" }, status: 400, data: null }] });
    await h.save(synthetic("fba"));
    assert.equal(h.requests.length, 1);
    assert(h.requests[0].payload.abc_entries);
    assert.equal(h.requests[0].payload.is_first_visit, true);
    assert(h.state.active);
    assert.match(h.state.toast.message, /all required observation fields/);
  }
  assert.equal(helpers.missingColumn("42501"), false);
});

test("reconciliation rejects partial/mismatched data and accepts JSON key ordering", () => {
  const write = { id: "synthetic-id", editing: true, payload: { behaviors: [{ count: 1, id: "synthetic" }], updated_at: "2026-01-01T00:00:00.000Z" } };
  assert(helpers.matchesWrite({ id: write.id, behaviors: [{ id: "synthetic", count: 1 }], updated_at: "2026-01-01T00:00:00+00:00" }, write));
  assert.equal(helpers.matchesWrite({ id: write.id, behaviors: [] }, write), false);
});

test("UPDATE confirmation permits database-generated updated_at timestamps", async () => {
  const h = harness({ editing: true, writes: [(request) => ({
    error: null, status: 200,
    data: [{ id: "synthetic-id", ...request.payload, updated_at: "2026-01-02T03:04:05.123456+00:00" }],
  })] });
  await h.save(synthetic());
  assert.equal(h.state.active, null);
  assert.equal(h.state.toast, null);
  assert.equal(h.requests.length, 1);
});

test("ambiguous UPDATE reconciles successfully with a server-generated updated_at", async () => {
  let submitted;
  const h = harness({ editing: true,
    writes: [(request) => {
      submitted = request.payload;
      return { error: { code: "" }, status: 0, data: null };
    }],
    reads: [() => ({ error: null, status: 200, data: [{
      id: "synthetic-id", ...submitted, updated_at: "2026-02-03T04:05:06.123456+00:00",
    }] })],
  });
  await h.save(synthetic("fba"));
  assert.equal(h.state.active, null);
  assert.equal(h.state.toast, null);
  assert.equal(h.requests.filter((request) => request.method === "update").length, 1);
  assert.equal(h.requests.filter((request) => request.method === "read").length, 1);
});

test("changed observation fields reject UPDATE confirmation despite a server timestamp", async () => {
  const changes = {
    subject_name: "synthetic-changed", observer_name: "synthetic-changed", type: "classroom",
    district: "synthetic-changed", school_name: "synthetic-changed", grade: "Grade 10",
    total_students: 5, start_time: 1001, end_time: 2001, total_duration: 2,
    behaviors: [{ id: "synthetic-behavior", count: 3, durationSec: 2 }],
    notes: "synthetic-changed", recommendations: "synthetic-changed",
    implementation_status: "fully", implementation_notes: "synthetic-changed",
    observation_type: "classroom", is_first_visit: false,
    abc_entries: [{ antecedent: "synthetic", behavior: "synthetic", consequence: "synthetic-changed" }],
    latency_records: [5], fba_latency_events: [{ latencySec: 5 }], interval_records: [true],
    interval_length_sec: 10, fba_interval_sessions: [{ records: [{ behaviorPresent: true }] }],
  };
  // Cover both a misleading write response and a read after a lost write response.
  for (const directResponse of [false, true]) {
    for (const [field, changed] of Object.entries(changes)) {
      let submitted;
      const mismatched = () => ({
        id: "synthetic-id", ...submitted,
        updated_at: "2026-02-03T04:05:06.123456+00:00", [field]: changed,
      });
      const h = harness({ editing: true,
        writes: [(request) => {
          submitted = request.payload;
          return directResponse
            ? { error: null, status: 200, data: [mismatched()] }
            : { error: { code: "" }, status: 0, data: null };
        }],
        reads: [() => ({ error: null, status: 200, data: [mismatched()] })],
      });
      await h.save(synthetic("fba"));
      assert(h.state.active, `${field}: editor must remain open`);
      assert.equal(h.state.unconfirmed, true, field);
      assert.equal(h.context.pendingWrite.current.id, "synthetic-id", field);
      assert.equal(h.context.pendingSnapshot.current.behaviors[0].count, 2, field);
      assert.equal(h.state.data.visits.length, 0, field);
      assert.match(h.state.toast.message, /unconfirmed/, field);
      assert.equal(h.requests.filter((request) => request.method === "update").length, 1, field);
    }
  }
});

test("missing submitted fields cannot confirm a write", async () => {
  const h = harness({ editing: true });
  await h.save(synthetic("fba"));
  const payload = h.requests[0].payload;
  const write = { id: "synthetic-id", editing: true, payload };
  const complete = { id: write.id, ...payload, updated_at: "2026-02-03T04:05:06.123456+00:00" };
  assert.equal(helpers.matchesWrite(complete, write), true);
  for (const field of Object.keys(payload).filter((key) => key !== "updated_at")) {
    const partial = { ...complete };
    delete partial[field];
    assert.equal(helpers.matchesWrite(partial, write), false, field);
  }
  assert.equal(helpers.matchesWrite({ ...complete, id: "synthetic-other-id" }, write), false);
  assert.equal(helpers.matchesWrite(null, write), false);
  assert.equal(helpers.matchesWrite(Object.create(complete), write), false);
  assert.equal(helpers.matchesWrite({ id: write.id }, { ...write, payload: { notes: undefined } }), false);
});

test("all workflows start repeatedly despite malformed synthetic history", () => {
  for (const type of ["student", "classroom", "fba"]) {
    let active; let clearedEditing;
    const c = evaluate(startSource + "\nglobalThis.start = startVisit;", {
      ...helpers, historyLoading: false, historyError: "", data: { visits: [{ subjectName: null }, { subjectName: 42 }] },
      newVisitForm: { type, subjectName: "synthetic", observerName: "synthetic", grade: "Grade 9", selectedDistrict: "synthetic", schoolName: "synthetic" },
      selectedFirstVisit: true, implementationStatus: "", uid: () => "synthetic-id",
      setSaveToast() {}, setEditingVisitId: (id) => { clearedEditing = id; },
      setActiveVisit: (visit) => { active = visit; }, setScreen() {},
    });
    c.start(); c.start();
    assert.equal(active.type, type);
    assert.equal(clearedEditing, null);
    c.historyError = "synthetic load failure"; active = null; c.start();
    assert.equal(active, null);
  }
  assert.match(page, /id: "rhs9", label: "9th Grade RHS", type: "classroom"/);
});

function authHarness(getUser) {
  const source = fs.readFileSync("src/components/auth/AuthProvider.tsx", "utf8");
  const ast = ts.createSourceFile("auth.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === "AuthProvider");
  const effect = fn.body.statements.find((node) => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect").expression.arguments[0];
  const candidate = { user: { id: "synthetic-user" }, access_token: "synthetic-token", expires_at: Date.now() / 1000 + 600 };
  const state = { signouts: 0, redirects: [], user: null };
  let listener;
  const context = evaluate("globalThis.effect = " + effect.getText(ast), {
    ...helpers, verified: { current: null }, isLoginPage: false,
    router: { replace: (path) => state.redirects.push(path) },
    setSession: (value) => { state.session = value; },
    setUser: (value) => { state.user = value; },
    setIsLoading: (value) => { state.loading = value; },
    setAuthError: (value) => { state.error = value; }, setSessionExpired() {},
    supabase: { auth: {
      getSession: async () => ({ error: null, data: { session: candidate } }),
      getUser,
      signOut: async () => { state.signouts++; return { error: null }; },
      onAuthStateChange: (callback) => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    } },
  });
  const cleanup = context.effect();
  return { state, context, candidate, cleanup,
    emit: (session, event = session ? "SIGNED_IN" : "SIGNED_OUT") => listener(event, session) };
}
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); };

test("transient initial getUser failure blocks access without sign-out and supports retry", async () => {
  let fail = true;
  const h = authHarness(async () => fail
    ? { error: { status: 503 }, data: { user: null } }
    : { error: null, data: { user: { id: "synthetic-user" } } });
  await flush();
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.user, null);
  assert.match(h.state.error, /retry/);
  fail = false; h.cleanup(); const cleanup = h.context.effect();
  await flush(); assert.equal(h.state.user.id, "synthetic-user"); cleanup();
});

test("temporary listener failure preserves a previously verified user/editor", async () => {
  let fail = false;
  const h = authHarness(async () => {
    if (fail) throw new TypeError("synthetic network failure");
    return { error: null, data: { user: { id: "synthetic-user" } } };
  });
  await flush(); fail = true; h.emit(h.candidate); await flush();
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.user.id, "synthetic-user");
  assert.match(h.state.error, /retry/); h.cleanup();
});

test("null INITIAL_SESSION after a temporary SDK failure does not discard a verified editor", async () => {
  const h = authHarness(async () => ({ error: null, data: { user: { id: "synthetic-user" } } }));
  await flush();
  h.context.supabase.auth.getSession = async () => ({ error: { status: 503 }, data: { session: null } });
  h.emit(null, "INITIAL_SESSION");
  await flush();
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.user.id, "synthetic-user");
  assert.equal(h.state.redirects.length, 0);
  assert.match(h.state.error, /retry/);
  h.context.supabase.auth.getSession = async () => ({ error: null, data: { session: h.candidate } });
  h.emit(null, "INITIAL_SESSION");
  await flush();
  assert.equal(h.state.error, "");
  assert.equal(h.state.user.id, "synthetic-user");
  h.cleanup();
});

test("null INITIAL_SESSION grants no initial access and a confirmed missing session redirects", async () => {
  const h = authHarness(async () => ({ error: { status: 503 }, data: { user: null } }));
  await flush();
  h.context.supabase.auth.getSession = async () => ({ error: { status: 503 }, data: { session: null } });
  h.emit(null, "INITIAL_SESSION"); await flush();
  assert.equal(h.state.user, null);
  assert.equal(h.state.session, undefined);
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.redirects.length, 0);
  h.context.supabase.auth.getSession = async () => ({ error: null, data: { session: null } });
  h.emit(null, "INITIAL_SESSION"); await flush();
  assert.equal(h.state.user, null);
  assert(h.state.redirects.includes("/login"));
  h.cleanup();
});

test("older invalid verification cannot override a newer verified user and role", async () => {
  let finishOld;
  let calls = 0;
  const verifiedUser = { id: "synthetic-user", app_metadata: { role: "consultant" } };
  const h = authHarness(() => ++calls === 1
    ? new Promise((resolve) => { finishOld = resolve; })
    : Promise.resolve({ error: null, data: { user: verifiedUser } }));
  await flush();
  h.emit({ ...h.candidate, access_token: "synthetic-new-token" }, "TOKEN_REFRESHED");
  await flush();
  finishOld({ error: { status: 401, code: "session_not_found" }, data: { user: null } });
  await flush();
  assert.equal(h.state.user, verifiedUser);
  assert.equal(h.state.user.app_metadata.role, "consultant");
  assert.equal(h.state.session.access_token, "synthetic-new-token");
  assert.equal(h.state.signouts, 0);
  assert.equal(h.state.redirects.length, 0);
  h.cleanup();
});

test("definitively invalid session removes access and performs local cleanup", async () => {
  const h = authHarness(async () => ({ error: { status: 401, code: "session_not_found" }, data: { user: null } }));
  await flush(); assert.equal(h.state.user, null);
  assert.equal(h.state.signouts, 1); assert(h.state.redirects.includes("/login")); h.cleanup();
});

test("stale async verification cannot restore a signed-out session", async () => {
  let finish;
  const h = authHarness(() => new Promise((resolve) => { finish = resolve; }));
  await flush(); h.emit(null);
  finish({ error: null, data: { user: { id: "synthetic-user" } } });
  await flush(); assert.equal(h.state.user, null); h.cleanup();
});

test("diagnostics exclude synthetic student names, tokens, and payloads", () => {
  let logged;
  const diagnostics = evaluate(fs.readFileSync("src/lib/reliability.ts", "utf8"), { console: { warn: (...args) => { logged = args; } } }).exports;
  diagnostics.logDiagnostic("synthetic-operation", { message: "synthetic-private-name", details: "synthetic-token", payload: synthetic(), status: 400, code: "42501" });
  const text = JSON.stringify(logged);
  assert(!text.includes("synthetic-private-name")); assert(!text.includes("synthetic-token"));
  assert(!text.includes("behaviors")); assert(text.includes("42501"));
});

test("history failure retains cached records and recovery replaces them only on success", async () => {
  const historySource = declaration(page, "PageInner", "fetchPersistedVisits");
  let response = { error: { code: "synthetic" }, status: 503, data: null };
  const state = { data: { visits: [synthetic()], subjects: [] } };
  const query = {
    select() { return query; }, order() { return query; }, eq() { return query; }, abortSignal() { return query; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  const c = evaluate(historySource + "\nglobalThis.load = fetchPersistedVisits;", {
    ...helpers, useCallback: (fn) => fn, userId: "synthetic-user", canManageAllObservations: false,
    historyGeneration: { current: 0 }, historyOwner: { current: "synthetic-user" },
    supabase: { from: () => query }, normalizeBehaviorList: (list) => Array.isArray(list) ? list : [],
    setData: (value) => { state.data = value; }, setHistoryLoading: (value) => { state.loading = value; },
    setHistoryError: (value) => { state.error = value; },
  });
  await c.load();
  assert.equal(state.data.visits.length, 1); assert(state.error); assert.equal(state.loading, false);
  response = { error: null, status: 200, data: [{ id: "synthetic", subject_name: null, behaviors: null }] };
  await c.load(); assert.equal(state.error, ""); assert.equal(state.data.visits[0].subjectName, "");
  response = { error: null, status: 200, data: [] };
  await c.load(); assert.equal(state.data.visits.length, 0);
});

test("stale history response cannot overwrite a newer history response", async () => {
  const historySource = declaration(page, "PageInner", "fetchPersistedVisits");
  const finishes = [];
  const state = {};
  function query() {
    const q = { select: () => q, order: () => q, eq: () => q, abortSignal: () => q,
      then(resolve, reject) { return new Promise((finish) => finishes.push(finish)).then(resolve, reject); } };
    return q;
  }
  const c = evaluate(historySource + "\nglobalThis.load = fetchPersistedVisits;", {
    ...helpers, useCallback: (fn) => fn, userId: "synthetic-user", canManageAllObservations: false,
    historyGeneration: { current: 0 }, historyOwner: { current: "synthetic-user" },
    supabase: { from: query }, normalizeBehaviorList: () => [],
    setData: (value) => { state.data = value; }, setHistoryLoading() {}, setHistoryError() {},
  });
  const older = c.load(); const newer = c.load(); await new Promise(setImmediate);
  finishes[1]({ error: null, status: 200, data: [{ id: "newer", subject_name: "synthetic" }] }); await newer;
  finishes[0]({ error: null, status: 200, data: [{ id: "older", subject_name: "synthetic" }] }); await older;
  assert.equal(state.data.visits[0].id, "newer");
});

test("database confirmation is not misreported as failure when navigation throws", async () => {
  const h = harness();
  h.context.router.push = () => { throw new Error("synthetic navigation failure"); };
  await h.save(synthetic());
  assert.match(h.state.toast.message, /was saved/);
  assert.equal(h.context.pendingWrite.current, null);
  assert.equal(h.state.saving, false);
});

test("password recovery redirect takes precedence over the signed-in login redirect", () => {
  const source = fs.readFileSync("src/app/login/page.tsx", "utf8");
  const ast = ts.createSourceFile("login.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === "LoginPage");
  const effects = fn.body.statements.filter((node) => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect")
    .map((node) => node.expression.arguments[0].getText(ast));
  const routes = [];
  let listener;
  const c = evaluate("globalThis.effects = [" + effects.join(",") + "];", {
    user: { id: "synthetic-user" }, session: {}, isRecoveryRef: { current: false },
    router: { replace: (path) => routes.push(path) },
    supabase: { auth: { onAuthStateChange: (callback) => {
      listener = callback; return { data: { subscription: { unsubscribe() {} } } };
    } } },
  });
  c.effects[1](); listener("PASSWORD_RECOVERY"); c.effects[0]();
  assert.deepEqual(routes, ["/change-password?recovery=1"]);
});
