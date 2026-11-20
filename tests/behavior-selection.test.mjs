import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// No app imports, environment variables, credentials, or network transports.
// Execute source handlers with simulated hook state and an in-memory database.
// Server-render the real shared UI; this is not a browser/layout test.
const page = fs.readFileSync("src/app/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionSource(name) {
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert(node, `Function ${name} must exist`);
  return node.getText(ast);
}
function declaration(name, component) {
  const statements = component
    ? ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === component).body.statements
    : ast.statements;
  const node = statements.find((item) => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some((entry) => entry.name.getText(ast) === name));
  assert(node, `Declaration ${name} must exist`);
  return node.getText(ast);
}
function evaluate(source, globals = {}) {
  const context = { exports: {}, setTimeout, clearTimeout, AbortController,
    console: { warn() {} }, ...globals };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context;
}
const intensity = evaluate(fs.readFileSync("src/lib/behavior-intensity.ts", "utf8")).exports;
const reliability = evaluate(fs.readFileSync("src/lib/reliability.ts", "utf8")).exports;
const componentSource = [declaration("BEHAVIOR_LIBRARY"), declaration("INTENSITY_LEVELS"),
  ...["uid", "fmtTime", "fmtDuration", "dateStr", "calcRate", "Badge", "IntensityPicker", "normalizeBehaviorList",
    "resetBehaviorForNewVisit", "appendBehaviorOccurrence", "setBehaviorOccurrenceIntensity",
    "useBehaviorDurationTimer", "BehaviorSetupSection", "ActiveVisit", "ActiveFbaVisit"].map(functionSource),
  "globalThis.api = { BEHAVIOR_LIBRARY, normalizeBehaviorList, resetBehaviorForNewVisit, BehaviorSetupSection, ActiveVisit, ActiveFbaVisit };",
].join("\n");
const json = (value) => JSON.parse(JSON.stringify(value));
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  return tree && typeof tree === "object" ? content(tree.props?.children)
    : tree == null || tree === false ? "" : String(tree);
}
function textareaValue(tree, placeholder) {
  const field = nodes(tree).find((node) => node.type === "textarea" && node.props.placeholder === placeholder);
  assert(field, `Expected textarea with placeholder "${placeholder}"`);
  return field.props.value;
}
const workflows = ["student", "classroom", "rhs9", "fba"];
function syntheticVisit(workflow, behaviors = []) {
  return { id: "synthetic-visit", type: workflow === "rhs9" ? "classroom" : workflow,
    subjectName: "Synthetic subject", observerName: "Synthetic observer", grade: "Grade 9",
    district: "Synthetic district", schoolName: "Synthetic school", totalStudents: 20,
    isFirstVisit: true, startTime: 1000, totalDuration: 10, behaviors };
}
function trackingHarness(workflow, { visit = syntheticVisit(workflow), editing = false } = {}) {
  let state = [], cursor = 0, tree, completed, effects = [], timerTick, now = 11_000;
  class SyntheticDate extends Date { static now() { return now; } }
  const context = evaluate(componentSource, {
    ...intensity, Date: SyntheticDate, crypto: { randomUUID },
    require(name) { assert.equal(name, "react/jsx-runtime"); return { jsx, jsxs, Fragment }; },
    useState(initial) {
      const index = cursor++, owner = state;
      if (!(index in owner)) owner[index] = typeof initial === "function" ? initial() : initial;
      return [owner[index], (value) => { owner[index] = typeof value === "function" ? value(owner[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect(effect) { effects.push(effect); },
    setInterval(tick) { timerTick = tick; return 1; }, clearInterval() {},
    ObservationDurationEditor() { return null; },
  });
  const api = context.api;
  const component = workflow === "fba" ? api.ActiveFbaVisit : api.ActiveVisit;
  function render() {
    cursor = 0; effects = [];
    tree = component({ visit, isEditing: editing, onComplete(value) { completed = value; } });
    return tree;
  }
  function section() { return nodes(tree).find((node) => node.type === api.BehaviorSetupSection).props; }
  function shared() {
    const previous = state;
    state = []; cursor = 0;
    try { return api.BehaviorSetupSection(section()); } finally { state = previous; }
  }
  function html() {
    const previous = state;
    state = []; cursor = 0;
    try { return renderToStaticMarkup(jsx(api.BehaviorSetupSection, section())); } finally { state = previous; }
  }
  function complete() {
    const button = nodes(tree).find((node) => node.type === "button" &&
      /^(Complete Visit|Complete FBA|Save Changes)/.test(content(node)));
    assert(button);
    button.props.onClick();
    return completed;
  }
  render();
  return { api, render, section, shared, html, complete, tree: () => tree,
    tickDurations(ms) {
      now += ms;
      const effect = effects.find((item) => item.toString().includes("setDurationTimers"));
      assert(effect); effect(); timerTick(); render();
    },
    finishInterval() {
      const ticking = effects.find((effect) => effect.toString().includes("setIntervalCountdown"));
      const seconds = Number(content(tree).match(/Countdown: (\d+)s/)[1]);
      assert(ticking); ticking();
      for (let index = 0; index < seconds; index++) { now += 1000; timerTick(); }
      render();
      const finish = effects.find((effect) => effect.toString().includes("intervalCountdown !== 0"));
      assert(finish); finish(); render();
    },
    advance(ms) { now += ms; } };
}
function persistenceHarness(api, { writes = [] } = {}) {
  const rows = new Map(), requests = [], state = { data: { visits: [], subjects: [] } };
  const client = { from(table) {
    assert.equal(table, "visits");
    let operation = "select", payload;
    const filters = [];
    const query = {
      insert(values) { operation = "insert"; payload = values[0]; return query; },
      update(value) { operation = "update"; payload = value; return query; },
      select() { return query; }, order() { return query; }, abortSignal() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      then(resolve, reject) {
        requests.push({ table, operation, payload: payload && json(payload), filters });
        if (operation !== "select" && writes.length) {
          const response = writes.shift();
          return (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)).then(resolve, reject);
        }
        let result;
        if (operation === "insert") {
          assert(!rows.has(payload.id)); rows.set(payload.id, json(payload)); result = [rows.get(payload.id)];
        } else if (operation === "update") {
          const row = [...rows.values()].find((item) => filters.every(([key, value]) => item[key] === value));
          assert(row, "Owned observation must exist before UPDATE");
          Object.assign(row, json(payload)); result = [row];
        } else result = [...rows.values()].filter((item) => filters.every(([key, value]) => item[key] === value));
        return Promise.resolve({ error: null, status: 200, data: json(result) }).then(resolve, reject);
      },
    };
    return query;
  } };
  const context = evaluate([declaration("completeVisit", "PageInner"),
    declaration("fetchPersistedVisits", "PageInner"), declaration("startVisit", "PageInner"),
    declaration("editVisit", "PageInner"),
    "globalThis.handlers = { completeVisit, fetchPersistedVisits, startVisit, editVisit };",
  ].join("\n"), {
    ...reliability, ...api, supabase: client, user: { id: "synthetic-user" }, userId: "synthetic-user",
    canManageAllObservations: false, editingVisitId: null, useCallback: (fn) => fn,
    saveInFlight: { current: false }, pendingWrite: { current: null }, pendingSnapshot: { current: null },
    historyGeneration: { current: 0 }, historyOwner: { current: "synthetic-user" },
    historyLoading: false, historyError: "", selectedFirstVisit: false, implementationStatus: "fully",
    uid: () => "synthetic-next-visit",
    setIsSaving(value) { state.saving = value; }, setSaveUnconfirmed(value) { state.unconfirmed = value; },
    setSaveToast(value) { state.toast = value; }, setHistoryLoading() {},
    setHistoryError(value) { state.historyError = value; },
    setData(value) { state.data = typeof value === "function" ? value(state.data) : value; },
    setActiveVisit(value) { state.active = value; }, setSelectedVisit() {},
    setEditingVisitId() {}, setScreen() {}, setTab() {}, setNewVisitForm() {},
    setObservationSelectionCard() {}, setImplementationStatus() {}, router: { push() {} },
  });
  return { state, requests, rows, context, ...context.handlers };
}

for (const workflow of workflows) {
  for (const count of [1, 2, 3, 4, 6, 10]) {
    for (const mode of ["library", "custom"]) {
      test(`${workflow}: add, track, render, save, reload, edit ${count} ${mode} behaviors`, async () => {
        const h = trackingHarness(workflow);
        h.section().onToggleAddBehavior(); h.render();
        for (let index = 0; index < count; index++) {
          const before = json(h.section().behaviors);
          if (mode === "library") {
            const available = h.section().availableLib.find((item) => item.type === "frequency" && !item.measureType);
            assert(available);
            h.section().onAddBehaviorFromLibrary(available);
          } else {
            h.section().setCustomBehavior({ label: `Synthetic behavior ${index}`, type: index % 2 ? "duration" : "frequency", behaviorType: "challenging" });
            h.render(); h.section().onAddCustomBehavior();
          }
          h.render();
          assert.equal(h.section().behaviors.length, index + 1);
          assert.deepEqual(json(h.section().behaviors).slice(0, index), before);
          assert.equal(h.section().showAddBehavior, true, "Picker remains open after every addition");
          const behavior = h.section().behaviors[index];
          if (behavior.type === "duration") {
            h.section().onToggleDuration(behavior.id); h.render(); h.advance(2500);
            h.section().onToggleDuration(behavior.id); h.render();
            assert.equal(h.section().durationTimers[behavior.id], 2);
          } else {
            h.section().onRecordFrequency(behavior.id); h.render();
            assert.equal(h.section().behaviors[index].count, 1);
          }
          assert.equal(h.section().behaviors[index].occurrences.length, 1);
          h.section().onSkipIntensity(); h.render();
        }
        const selected = json(h.section().behaviors);
        const markup = h.html();
        for (const behavior of selected) assert(markup.includes(behavior.label));
        const shared = h.shared();
        assert.equal(nodes(shared).filter((node) => node.type === "div" && selected.some((item) => item.id === node.key)).length, count);
        const add = nodes(shared).find((node) => node.type === "button" && content(node).includes("Add Behavior"));
        assert(add && !add.props.disabled);
        assert.equal(add.props["aria-expanded"], true);
        const children = shared.props.children.flat().filter((child) => child && typeof child === "object");
        assert(content(children[0]).includes("Add Behavior"));
        assert(content(children[1]).includes("BEHAVIOR LIBRARY"), "Picker immediately follows its toggle");
        assert.equal(children[1].props.id, add.props["aria-controls"]);
        h.section().onToggleAddBehavior(); h.render();
        assert.equal(h.section().showAddBehavior, false);
        assert.deepEqual(json(h.section().behaviors), selected, "Closing picker preserves tracking");
        const completed = h.complete();
        assert.equal(completed.behaviors.length, count);
        const p = persistenceHarness(h.api);
        await p.completeVisit(completed);
        assert.equal(p.state.toast, null); assert.equal(p.state.active, null);
        const inserted = p.requests.find((request) => request.operation === "insert");
        assert.deepEqual(inserted.payload.behaviors, json(completed.behaviors));
        await p.fetchPersistedVisits();
        assert.equal(p.state.historyError, "");
        const loaded = p.state.data.visits[0];
        assert.deepEqual(json(loaded.behaviors), json(completed.behaviors));
        p.editVisit(loaded);
        const edit = trackingHarness(workflow, { visit: p.state.active, editing: true });
        assert.equal(edit.section().behaviors.length, count);
        p.context.editingVisitId = loaded.id;
        const updated = edit.complete();
        await p.completeVisit(updated);
        const update = p.requests.find((request) => request.operation === "update");
        assert.deepEqual(update.payload.behaviors, json(updated.behaviors));
        assert(update.filters.some(([key, value]) => key === "created_by" && value === "synthetic-user"));
        await p.fetchPersistedVisits();
        assert.deepEqual(json(p.state.data.visits[0].behaviors), json(updated.behaviors));
      });
    }
  }
  test(`${workflow}: subsequent observations start with fresh notes and measurements, and saved edits restore them`, async () => {
    const h = trackingHarness(workflow), p = persistenceHarness(h.api);
    const type = workflow === "rhs9" ? "classroom" : workflow;
    const library = h.api.BEHAVIOR_LIBRARY[type === "fba" ? "student" : type];
    // The reported three-library/seven-custom case must retain all ten selections.
    const behaviors = [...library.slice(0, 3), ...Array.from({ length: 7 }, (_, index) => ({
      id: `synthetic-custom-${index}`, label: `Synthetic ${index}`, custom: true,
      type: index % 2 ? "duration" : "frequency", category: index % 2 ? "challenging" : "positive",
      supportsDuration: true, supportsStudentCount: true, measureType: "student-count",
    }))].map((item) => ({ ...item, count: 5, studentCount: 9, durationSec: item.supportsDuration ? 30 : undefined, intensity: 4,
      occurrences: [{ timestamp: 1000, intensity: 4 }], intensityRecords: [{ timestamp: 1000, intensity: 4 }],
      note: "Synthetic previous behavior note", legacyObservationText: "Synthetic legacy behavior text",
      legacyMeasurementHistory: [9] }));
    const previous = {
      ...syntheticVisit(workflow, behaviors), endTime: 11_000,
      notes: "Synthetic previous observation note", recommendations: "Synthetic previous recommendation",
      implementationStatus: "partially", implementationNotes: "Synthetic previous implementation note",
      ...(workflow === "fba" ? {
        abcEntries: [{ antecedent: "Synthetic antecedent", behavior: "Synthetic event", consequence: "Synthetic consequence" }],
        latencyRecords: [5],
        fbaLatencyEvents: [{ behaviorId: null, behaviorLabel: "Synthetic latency target", startTime: 1000, stopTime: 6000, latencySec: 5, timestamp: 6000 }],
        intervalLengthSec: 5,
        intervalRecords: [true],
        fbaIntervalSessions: [{ behaviorId: null, behaviorLabel: "Synthetic interval target", intervalLengthSec: 5,
          startedAt: 1000, records: [{ intervalNumber: 1, behaviorPresent: true, timestamp: 6000 }] }],
      } : {}),
    };
    const original = json(previous);
    await p.completeVisit(previous);
    const originalRow = json(p.rows.get(previous.id));
    await p.fetchPersistedVisits();
    assert.equal(p.state.data.visits[0].behaviors.length, 10, "Mixed library/custom selections survive saving and loading");
    p.context.data = p.state.data;
    p.context.newVisitForm = { type, subjectName: previous.subjectName, observerName: previous.observerName,
      grade: previous.grade, selectedDistrict: previous.district, schoolName: previous.schoolName };
    p.startVisit();
    const draft = p.state.active;
    assert.equal(draft.notes, "");
    assert.equal(draft.recommendations, "");
    assert.equal(draft.implementationNotes, "");
    assert.equal(draft.implementationStatus, workflow === "fba" ? undefined : "fully");
    assert.equal(draft.totalDuration, undefined);
    assert.equal(draft.endTime, undefined);
    assert.equal(draft.behaviors.length, workflow === "fba" ? 0 : 10);
    if (workflow === "fba") assert.equal(draft.previousFeedback, undefined);
    else assert.deepEqual(json(draft.previousFeedback), { recommendations: previous.recommendations, observedAt: previous.endTime });
    assert.equal("prevVisit" in draft, false);
    for (const behavior of draft.behaviors) {
      const saved = previous.behaviors.find((item) => item.id === behavior.id);
      for (const key of ["id", "label", "category", "type", "custom", "measureType", "supportsDuration", "supportsStudentCount"]) {
        assert.equal(behavior[key], saved[key], `Preserve ${key}`);
      }
      assert.equal(behavior.count, 0); assert.equal(behavior.studentCount, 0);
      assert.equal(behavior.durationSec, 0); assert.equal(behavior.intensity, null);
      assert.equal(behavior.note, "");
      assert.equal("legacyObservationText" in behavior, false);
      assert.equal("legacyMeasurementHistory" in behavior, false);
      assert.deepEqual(json(behavior.occurrences), []); assert.deepEqual(json(behavior.intensityRecords), []);
    }
    assert.deepEqual(json(previous), original, "Original observation is unchanged");
    const next = trackingHarness(workflow, { visit: draft });
    assert.equal(textareaValue(next.tree(), "Contextual notes..."), "");
    assert.equal(textareaValue(next.tree(), "Interventions or recommendations..."), "");
    assert.equal(content(next.tree()).includes(previous.recommendations), workflow !== "fba");
    if (workflow !== "fba") {
      assert.equal(textareaValue(next.tree(), "Optional notes on implementation..."), "");
      assert.match(content(next.tree()), /FOLLOW-UP: Recommendations from/);
    }
    next.section().onAddBehaviorFromLibrary(next.section().availableLib[0]); next.render();
    assert.equal(next.section().behaviors.length, workflow === "fba" ? 1 : 11,
      "Subsequent observations still permit additional behaviors");
    const completed = next.complete();
    if (workflow === "fba") {
      assert.deepEqual(json(completed.abcEntries), Array.from({ length: 3 }, () => ({ antecedent: "", behavior: "", consequence: "" })));
      for (const field of ["latencyRecords", "fbaLatencyEvents", "intervalRecords", "fbaIntervalSessions"]) {
        assert.deepEqual(json(completed[field]), [], field);
      }
    }
    await p.completeVisit(completed);
    assert.equal(p.rows.get(completed.id).notes, "");
    assert.equal(p.rows.get(completed.id).recommendations, "");
    assert.equal("previousFeedback" in p.rows.get(completed.id), false);
    assert.deepEqual(p.rows.get(previous.id), originalRow, "Saving the next observation leaves the original row intact");

    await p.fetchPersistedVisits();
    p.editVisit(p.state.data.visits.find((visit) => visit.id === previous.id));
    const edit = trackingHarness(workflow, { visit: p.state.active, editing: true });
    assert.equal(textareaValue(edit.tree(), "Contextual notes..."), previous.notes);
    assert.equal(textareaValue(edit.tree(), "Interventions or recommendations..."), previous.recommendations);
    if (workflow !== "fba") assert.equal(textareaValue(edit.tree(), "Optional notes on implementation..."), previous.implementationNotes);
    p.context.editingVisitId = previous.id;
    await p.completeVisit(edit.complete());
    const reopenedRow = p.rows.get(previous.id);
    for (const field of ["notes", "recommendations", "implementation_status", "implementation_notes", "behaviors",
      "total_duration", "abc_entries", "latency_records", "fba_latency_events", "interval_records", "fba_interval_sessions"]) {
      assert.deepEqual(reopenedRow[field], originalRow[field], field);
    }
  });
}

const browser = [
  path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
].find((file) => fs.existsSync(file));
function runBehaviorBrowser(width, height, document) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "inmind-behavior-browser-"));
  try {
    const fixture = path.join(directory, "synthetic.html");
    // A fixed-size child viewport avoids platform window-frame/minimum-size differences.
    const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    fs.writeFileSync(fixture, `<!doctype html><body style="margin:0"><iframe style="border:0;width:${width}px;height:${height}px" srcdoc="${escaped}"></iframe></body>`);
    return execFileSync(browser, ["--headless", "--disable-gpu", "--in-process-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions",
      `--user-data-dir=${path.join(directory, "profile")}`, `--window-size=${Math.max(width + 100, 1280)},${height + 200}`, "--dump-dom", pathToFileURL(fixture).href],
    { encoding: "utf8", timeout: 30_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith("inmind-behavior-browser-"));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("browser: recording near the bottom of the viewport keeps Record (+1) in view when intensity opens", { skip: !browser }, () => {
  const h = trackingHarness("student");
  const behavior = h.section().availableLib.find((item) => item.category === "challenging" && item.type === "frequency");
  h.section().onAddBehaviorFromLibrary(behavior); h.render();
  const before = h.html();
  h.section().onRecordFrequency(behavior.id); h.render();
  const after = h.html();
  const output = runBehaviorBrowser(390, 640, `<!doctype html>
    <html style="overflow-anchor:none"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="margin:0;padding:16px"><div id="spacer"></div><main id="tracker">${before}</main>
    <template id="pending">${after}</template><script>
      const tracker = document.querySelector('#tracker');
      const record = () => [...tracker.querySelectorAll('button')].find(button => button.textContent === 'Record (+1)');
      document.querySelector('#spacer').style.height = (innerHeight - record().getBoundingClientRect().bottom - 45) + 'px';
      const before = record().getBoundingClientRect();
      tracker.replaceChildren(document.querySelector('#pending').content.cloneNode(true));
      const after = record().getBoundingClientRect();
      const report = window.parent.document.body;
      report.dataset.recordBeforeVisible = before.top >= 0 && before.bottom <= innerHeight;
      report.dataset.recordAfterVisible = after.top >= 0 && after.bottom <= innerHeight;
      report.dataset.recordShift = Math.round(after.top - before.top);
      report.dataset.recordPending = record().disabled && Boolean(tracker.querySelector('[aria-label="Intensity rating"]'));
    </script></body></html>`);
  assert(/data-record-before-visible="true"/.test(output), "The button must start inside the viewport");
  assert(/data-record-pending="true"/.test(output), "The rating must open with recording temporarily disabled");
  const shift = output.match(/data-record-shift="(-?\d+)"/)?.[1];
  assert(/data-record-after-visible="true"/.test(output), `Rating moved Record (+1) by ${shift}px and out of the viewport`);
  assert.equal(shift, "0", "Opening the rating must leave the recorded behavior's control in place");
});

for (const [width, height] of [[390, 844], [1280, 900]]) {
  test(`browser ${width}px: pending intensity permits pointer access to Add, library, and custom controls`, { skip: !browser }, () => {
    const h = trackingHarness("student");
    h.section().onAddBehaviorFromLibrary(h.section().availableLib.find((item) => item.category === "challenging" && item.type === "frequency")); h.render();
    h.section().onRecordFrequency(h.section().behaviors[0].id); h.render();
    h.section().onToggleAddBehavior(); h.render();
    h.section().setCustomBehavior({ label: "Synthetic custom", type: "frequency", behaviorType: "positive" }); h.render();
    const output = runBehaviorBrowser(width, height, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;box-sizing:border-box">${h.html()}<script>
        const controls = [document.querySelector('button[aria-controls="behavior-picker"]'),
          document.querySelector('#behavior-picker button'),
          [...document.querySelectorAll('#behavior-picker button')].at(-1),
          document.querySelector('input[placeholder="Behavior name..."]')];
        const hits = controls.map(control => {
          control.scrollIntoView({block:'center'});
          const box = control.getBoundingClientRect();
          const target = document.elementFromPoint(box.x + box.width/2, box.y + box.height/2);
          return !control.matches(':disabled') && (target === control || control.contains(target));
        });
        const report = window.parent.document.body;
        report.dataset.behaviorHits = hits.join(',');
        report.dataset.overflow = [document.querySelector('#behavior-picker'), document.querySelector('[aria-label="Intensity rating"]')].some(element => {
          const box = element.getBoundingClientRect();
          return box.width > window.innerWidth || box.right > window.innerWidth || element.scrollWidth > element.clientWidth;
        });
        report.dataset.viewport = window.innerWidth;
      </script></body></html>`);
    assert.equal(output.match(/data-behavior-hits="([^"]*)"/)?.[1], "true,true,true,true", "Rendered controls must receive pointer hits while intensity is pending");
    assert.equal(output.match(/data-overflow="([^"]*)"/)?.[1], "false", "Picker and intensity prompt must fit the viewport");
    assert.equal(Number(output.match(/data-viewport="([^"]*)"/)?.[1]), width, "Check the actual viewport width");
  });
}

for (const workflow of ["student", "classroom", "rhs9"]) {
  test(`${workflow}: preload deduplicates IDs and excludes obsolete built-ins`, () => {
    const h = trackingHarness(workflow), p = persistenceHarness(h.api);
    const base = syntheticVisit(workflow);
    const definition = h.api.BEHAVIOR_LIBRARY[base.type][0];
    const custom = { id: "synthetic-custom", label: "Synthetic custom", custom: true, type: "duration", category: "challenging" };
    p.context.data = { visits: [{ ...base, behaviors: [definition, definition, custom, custom,
      { id: "synthetic-obsolete", label: "Obsolete", type: "frequency" }] }] };
    p.context.newVisitForm = { type: base.type, subjectName: base.subjectName, observerName: base.observerName,
      grade: base.grade, selectedDistrict: base.district, schoolName: base.schoolName };
    p.startVisit();
    assert.deepEqual(json(p.state.active.behaviors.map((item) => item.id)), [definition.id, custom.id]);
  });
  test(`${workflow}: unrelated subject, type, school, or district never supplies behaviors`, () => {
    const h = trackingHarness(workflow), p = persistenceHarness(h.api);
    const base = syntheticVisit(workflow);
    p.context.newVisitForm = { type: base.type, subjectName: base.subjectName, observerName: base.observerName,
      grade: base.grade, selectedDistrict: base.district, schoolName: base.schoolName };
    for (const mismatch of [{ subjectName: "Different subject" },
      { type: base.type === "student" ? "classroom" : "student" },
      { schoolName: "Different school" }, { district: "Different district" }]) {
      p.context.data = { visits: [{ ...base, ...mismatch, behaviors: [{ id: "synthetic-custom", custom: true, label: "Synthetic" }] }] };
      p.startVisit();
      assert.equal(p.state.active.behaviors.length, 0, JSON.stringify(mismatch));
      assert.equal(p.state.active.previousFeedback, undefined);
    }
    p.context.data = { visits: [] };
    p.context.selectedFirstVisit = true; p.startVisit();
    assert.equal(p.state.active.isFirstVisit, true);
    assert.equal(p.state.active.behaviors.length, 0);
    p.context.selectedFirstVisit = false; p.context.implementationStatus = "";
    p.state.active = null; p.startVisit();
    assert.equal(p.state.active, null, "Existing subsequent-visit implementation requirement remains enforced");
  });
}

test("FBA: three initial ABC entries, six-entry cap, and ten independent behaviors", () => {
  const h = trackingHarness("fba");
  const addEntry = () => nodes(h.tree()).find((node) => node.type === "button" && content(node) === "Add Entry");
  assert(content(h.tree()).includes("ABC RECORDING (3/6)"));
  assert.equal(addEntry().props.disabled, false);
  for (let index = 0; index < 3; index++) { addEntry().props.onClick(); h.render(); }
  assert(content(h.tree()).includes("ABC RECORDING (6/6)"));
  assert.equal(addEntry().props.disabled, true);
  addEntry().props.onClick(); h.render();
  for (let index = 0; index < 10; index++) {
    h.section().onAddBehaviorFromLibrary(h.section().availableLib[0]); h.render();
  }
  const completed = h.complete();
  assert.equal(completed.abcEntries.length, 6); assert.equal(completed.behaviors.length, 10);
});

test("RHS setup card selects classroom tracking with the RHS presets", () => {
  let handler;
  function find(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick" &&
      node.initializer?.getText(ast).includes('const isRhs9 = option.id === "rhs9"')) {
      handler = node.initializer.expression.getText(ast);
    }
    ts.forEachChild(node, find);
  }
  find(ast);
  assert(handler);
  let form = {}, selected;
  const context = evaluate([...["RHS_9TH_GRADE_VALUE", "RHS_DISTRICT_SELECTION", "RHS_DISTRICT_NAME", "RHS_SCHOOL_NAME"].map((name) => declaration(name)),
    `globalThis.choose = ${handler};`].join("\n"), {
    option: { id: "rhs9", type: "classroom" }, observationSelectionCard: "student", selectedFirstVisit: true,
    setImplementationStatus() {}, setObservationSelectionCard(value) { selected = value; },
    setNewVisitForm(update) { form = update(form); },
  });
  context.choose();
  assert.equal(selected, "rhs9"); assert.equal(form.type, "classroom");
  assert.equal(form.grade, "Grade 9"); assert.equal(form.schoolName, "Randolph High School");
});

function intervalHarness(visit, editing = false) {
  const h = trackingHarness("fba", { visit, editing });
  const select = () => nodes(h.tree()).find((node) => node.type === "select" &&
    node.props.onChange?.toString().includes("switchIntervalTarget"));
  return Object.assign(h, {
    choose(id) { select().props.onChange({ target: { value: id } }); h.render(); },
    other(label) {
      const input = nodes(h.tree()).find((node) => node.type === "input" && node.props.placeholder === "Enter behavior...");
      assert(input); input.props.onChange({ target: { value: label } }); h.render();
    },
    length(seconds) {
      const input = nodes(h.tree()).find((node) => node.type === "input" && node.props.value != null &&
        node.props.onChange?.toString().includes("const n = Math.max"));
      assert(input); input.props.onChange({ target: { value: String(seconds) } }); h.render();
    },
    record(value) {
      const start = nodes(h.tree()).find((node) => node.type === "button" && content(node) === "Start Interval");
      if (!start.props.disabled) { start.props.onClick(); h.render(); }
      h.finishInterval();
      const button = nodes(h.tree()).find((node) => node.type === "button" &&
        node.props.onClick?.toString().includes(`recordInterval(${value})`));
      assert(button); button.props.onClick(); h.render();
    },
  });
}
function intervalBehaviors() {
  return Array.from({ length: 4 }, (_, index) => ({ id: `synthetic-${index}`, label: `Synthetic ${index}`, type: "frequency", category: "positive" }));
}

test("FBA: repeated switches preserve target records without duplicate sessions through save and edit", async () => {
  const behaviors = intervalBehaviors();
  const h = intervalHarness(syntheticVisit("fba", behaviors));
  h.choose(behaviors[0].id); h.record(true); h.record(false);
  h.choose(behaviors[1].id); h.record(false);
  h.choose(behaviors[2].id); h.record(true);
  h.choose(behaviors[0].id); h.record(true);
  h.choose(behaviors[3].id); h.choose(behaviors[0].id); // No empty session for the fourth target.
  const completed = h.complete();
  assert.equal(completed.fbaIntervalSessions.length, 3);
  assert.equal(completed.intervalRecords.length, 5);
  const byId = (visit, id) => visit.fbaIntervalSessions.find((session) => session.behaviorId === id);
  assert.deepEqual(json(byId(completed, behaviors[0].id).records.map((record) => record.behaviorPresent)), [true, false, true]);
  assert.deepEqual(json(byId(completed, behaviors[1].id).records.map((record) => record.behaviorPresent)), [false]);
  assert.deepEqual(json(byId(completed, behaviors[2].id).records.map((record) => record.behaviorPresent)), [true]);
  assert.deepEqual(json(h.complete()), json(completed), "Repeated save snapshots must not duplicate sessions");
  const p = persistenceHarness(h.api);
  await p.completeVisit(completed); await p.fetchPersistedVisits();
  const original = json(p.state.data.visits[0]);
  const edit = intervalHarness(p.state.data.visits[0], true);
  assert.deepEqual(json(edit.complete().fbaIntervalSessions), json(completed.fbaIntervalSessions));
  edit.choose(behaviors[1].id); edit.record(true); edit.choose(behaviors[0].id);
  const updated = edit.complete();
  assert.equal(updated.fbaIntervalSessions.length, 3);
  assert.equal(byId(updated, behaviors[1].id).records.length, 2);
  assert.equal(byId(updated, behaviors[0].id).records.length, 3);
  assert.deepEqual(json(p.state.data.visits[0]), original, "Editing must not mutate loaded history");
  p.context.editingVisitId = completed.id;
  await p.completeVisit(updated); await p.fetchPersistedVisits();
  assert.deepEqual(json(p.state.data.visits[0].fbaIntervalSessions), json(updated.fbaIntervalSessions));
});

test("FBA: Other labels and interval lengths keep separate records", () => {
  const h = intervalHarness(syntheticVisit("fba", intervalBehaviors()));
  h.choose("__other__"); h.other("Synthetic A"); h.record(true);
  h.other("Synthetic B"); h.record(false);
  h.other("Synthetic A"); h.length(15); h.record(false);
  h.length(10);
  const result = h.complete();
  assert.equal(result.fbaIntervalSessions.length, 3);
  assert.deepEqual(json(result.fbaIntervalSessions.map((session) => [session.behaviorId, session.behaviorLabel, session.intervalLengthSec, session.records.map((record) => record.behaviorPresent)])), [
    [null, "Synthetic A", 10, [true]], [null, "Synthetic B", 10, [false]], [null, "Synthetic A", 15, [false]],
  ]);
});

test("FBA: legacy unassigned intervals are preserved without assigning them to a new target", () => {
  const visit = { ...syntheticVisit("fba", intervalBehaviors()), intervalRecords: [true, false] };
  const h = intervalHarness(visit, true);
  h.choose(visit.behaviors[0].id); h.record(false);
  const result = h.complete();
  assert.equal(result.fbaIntervalSessions.length, 2);
  assert.equal(result.fbaIntervalSessions[0].behaviorId, null);
  assert.equal(result.fbaIntervalSessions[0].behaviorLabel, "Unspecified behavior");
  assert.deepEqual(json(result.fbaIntervalSessions[0].records.map((record) => record.behaviorPresent)), [true, false]);
  assert.equal(result.fbaIntervalSessions[1].behaviorId, visit.behaviors[0].id);
  const reopened = intervalHarness(result, true);
  assert.deepEqual(json(reopened.complete().fbaIntervalSessions), json(result.fbaIntervalSessions));
});

test("FBA: removing a target preserves its completed interval records", () => {
  const behaviors = Array.from({ length: 4 }, (_, index) => ({ id: `synthetic-${index}`, label: `Synthetic ${index}`, type: "frequency", category: "positive" }));
  const h = intervalHarness(syntheticVisit("fba", behaviors));
  h.choose(behaviors[0].id); h.record(true);
  h.section().onRemoveBehavior(behaviors[0].id); h.render();
  assert.equal(h.complete().fbaIntervalSessions[0].behaviorLabel, behaviors[0].label);
  assert.equal(h.complete().fbaIntervalSessions[0].records.length, 1);
});

test("FBA: saved empty or historical sessions do not duplicate legacy totals or lose labels", () => {
  const visit = syntheticVisit("fba", intervalBehaviors());
  visit.fbaIntervalSessions = [
    { behaviorId: "retired-behavior", behaviorLabel: "Synthetic retired", intervalLengthSec: 10, startedAt: 1000, records: [] },
    { behaviorId: visit.behaviors[1].id, behaviorLabel: visit.behaviors[1].label, intervalLengthSec: 10, startedAt: 2000,
      records: [{ intervalNumber: 1, behaviorPresent: true, timestamp: 3000 }] },
  ];
  visit.intervalRecords = [true];
  const h = intervalHarness(visit, true);
  assert.deepEqual(json(h.complete().fbaIntervalSessions), json(visit.fbaIntervalSessions));
  assert.deepEqual(json(h.complete().intervalRecords), [true]);
  h.choose(visit.behaviors[1].id); h.choose("");
  assert.deepEqual(json(h.complete().fbaIntervalSessions), json(visit.fbaIntervalSessions));
});

test("FBA: existing report calculations count preserved targets once and filter correctly", () => {
  const behaviors = intervalBehaviors(), h = intervalHarness(syntheticVisit("fba", behaviors));
  h.choose(behaviors[0].id); h.record(true); h.record(false);
  h.choose(behaviors[1].id); h.record(true); h.choose(behaviors[0].id);
  const completed = h.complete();
  const report = fs.readFileSync("src/app/fba-reports/page.tsx", "utf8");
  const reportAst = ts.createSourceFile("report.tsx", report, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = reportAst.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "FbaReportsPage");
  const computed = fn.body.statements.find((item) => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some((entry) => entry.name.getText(reportAst) === "computed")).getText(reportAst);
  for (const [filter, total, percent] of [["", 3, 2 / 3], [behaviors[0].label, 2, 1 / 2], [behaviors[1].label, 1, 1]]) {
    const context = evaluate(computed + "\nglobalThis.result = computed;", {
      ...intensity, behavior: filter, useMemo: (calculate) => calculate(), toMs: (value) => value, dateLabel: () => "Synthetic date",
      filteredSessions: [{ id: completed.id, start_time: completed.startTime, fba_interval_sessions: json(completed.fbaIntervalSessions) }],
    });
    assert.equal(context.result.perSession[0].intervalTotal, total);
    assert.equal(context.result.perSession[0].intervalPct, percent);
  }
});

for (const workflow of workflows) {
  for (const trigger of ["frequency", "duration"]) {
    test(`${workflow}: pending ${trigger} intensity must not block Add Behavior`, () => {
      const h = trackingHarness(workflow);
      h.section().setCustomBehavior({ label: "Synthetic challenging", type: trigger, behaviorType: "challenging" });
      h.render(); h.section().onAddCustomBehavior(); h.render();
      const id = h.section().behaviors[0].id;
      if (trigger === "frequency") h.section().onRecordFrequency(id);
      else {
        h.section().onToggleDuration(id); h.render(); h.advance(2500);
        h.section().onToggleDuration(id);
      }
      h.render();
      assert(h.section().pendingIntensity);
      const cardNodes = (behaviorId) => nodes(nodes(h.shared()).find((node) => node.key === behaviorId));
      const record = (behaviorId) => cardNodes(behaviorId).find((node) =>
        node.type === "button" && content(node) === "Record (+1)");
      assert(cardNodes(id).some((node) => node.props["aria-label"] === "Intensity rating"));
      if (trigger === "frequency") assert.equal(record(id).props.disabled, true);
      else assert.equal(record(id), undefined);
      assert(!nodes(h.shared()).some((node) => node.props?.style?.position === "fixed" &&
        node.props.style.inset === 0 && node.props.style.pointerEvents !== "none"),
      "A viewport-covering intensity backdrop intercepts Add Behavior clicks");
      const prompt = json(h.section().pendingIntensity);
      h.section().onToggleAddBehavior(); h.render();
      const library = h.section().availableLib[0];
      h.section().onAddBehaviorFromLibrary(library); h.render();
      h.section().setCustomBehavior({ label: "Synthetic additional", type: "frequency", behaviorType: "positive" });
      h.render(); h.section().onAddCustomBehavior(); h.render();
      assert.equal(h.section().behaviors.length, 3);
      assert.deepEqual(json(h.section().pendingIntensity), prompt);
      assert.equal(h.section().showAddBehavior, true);
      assert.equal(record(h.section().behaviors[2].id).props.disabled, false);
      h.section().onChooseIntensity(3); h.render();
      assert.equal(h.section().pendingIntensity, null);
      assert.equal(h.section().behaviors[0].occurrences[0].intensity, 3);
      if (trigger === "frequency") {
        assert.equal(h.section().behaviors[0].count, 1);
        assert.equal(record(id).props.disabled, false);
      }
      else assert.equal(h.section().durationTimers[id], 2);
    });
  }
  test(`${workflow}: duplicate queued library clicks must append only once`, () => {
    const h = trackingHarness(workflow), section = h.section(), definition = section.availableLib[0];
    section.onAddBehaviorFromLibrary(definition); section.onAddBehaviorFromLibrary(definition); h.render();
    assert.equal(h.section().behaviors.length, 1);
  });

  test(`${workflow}: first visit starts with blank notes and supports the first behavior addition`, () => {
    const initial = trackingHarness(workflow), p = persistenceHarness(initial.api);
    const visit = syntheticVisit(workflow);
    p.context.data = { visits: [] }; p.context.selectedFirstVisit = true;
    p.context.newVisitForm = { type: visit.type, subjectName: visit.subjectName, observerName: visit.observerName,
      grade: visit.grade, selectedDistrict: visit.district, schoolName: visit.schoolName };
    p.startVisit();
    assert.equal(p.state.active.behaviors.length, 0);
    assert.equal(p.state.active.previousFeedback, undefined);
    const h = trackingHarness(workflow, { visit: p.state.active });
    assert.equal(textareaValue(h.tree(), "Contextual notes..."), "");
    assert.equal(textareaValue(h.tree(), "Interventions or recommendations..."), "");
    const add = nodes(h.shared()).find((node) => node.type === "button" && content(node).includes("Add Behavior"));
    assert(add && !add.props.disabled); add.props.onClick(); h.render();
    h.section().onAddBehaviorFromLibrary(h.section().availableLib[0]); h.render();
    assert.equal(h.section().behaviors.length, 1);
  });

  for (const count of [2, 3, 4, 6, 10]) {
    test(`${workflow}: add behavior ${count} while tracking, without resetting measurements or timers`, async () => {
      const existing = Array.from({ length: count - 1 }, (_, index) => ({
        id: `synthetic-existing-${index}`, label: `Synthetic existing ${index}`, type: "frequency",
        category: "challenging", custom: true, supportsDuration: true, supportsStudentCount: true,
        count: 7, studentCount: 4, durationSec: 11, intensity: 2, note: "Synthetic note",
        occurrences: [{ timestamp: 1000, intensity: 2 }],
      }));
      const h = trackingHarness(workflow, { visit: syntheticVisit(workflow, existing) });
      const id = existing[0].id;
      h.section().onRecordFrequency(id); h.render(); h.section().onChooseIntensity(3); h.render();
      h.section().onToggleDuration(id); h.render(); h.tickDurations(2000);
      assert.equal(h.section().durationTimers[id], 13);
      const measurements = json(h.section().behaviors), timers = h.section().activeTimers;
      h.section().onToggleAddBehavior(); h.render();
      h.section().onAddBehaviorFromLibrary(h.section().availableLib[0]); h.render();
      assert.equal(h.section().behaviors.length, count);
      assert.deepEqual(json(h.section().behaviors).slice(0, count - 1), measurements);
      assert.equal(h.section().activeTimers, timers);
      assert.equal(timers.current[id], true);
      assert.equal(h.section().showAddBehavior, true);
      h.tickDurations(3000);
      assert.equal(h.section().durationTimers[id], 16);
      h.section().onToggleDuration(id); h.render();
      assert.equal(h.section().pendingIntensity.occurrenceType, "duration");
      h.section().setCustomBehavior({ label: "Synthetic after duration", type: "frequency", behaviorType: "positive" });
      h.render(); h.section().onAddCustomBehavior(); h.render();
      h.section().onChooseIntensity(4); h.render();
      h.section().onRecordFrequency(h.section().behaviors.at(-1).id); h.render();
      const completed = h.complete();
      assert.equal(completed.behaviors[0].count, 8);
      assert.equal(completed.behaviors[0].studentCount, 4);
      assert.equal(completed.behaviors[0].durationSec, 16);
      assert.equal(completed.behaviors[0].note, "Synthetic note");
      assert.deepEqual(json(completed.behaviors[0].occurrences.map((record) => record.intensity)), [2, 3, 4]);
      const p = persistenceHarness(h.api);
      await p.completeVisit(completed); await p.fetchPersistedVisits();
      const reopened = trackingHarness(workflow, { visit: p.state.data.visits[0], editing: true });
      assert.deepEqual(json(reopened.section().behaviors), json(completed.behaviors));
      assert.equal(reopened.section().durationTimers[id], 16);
    });
  }
}

function observationFieldset(saving, unconfirmed, visit, api) {
  let element;
  function find(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "fieldset" &&
      node.openingElement.attributes.getText(ast).includes("saveUnconfirmed")) element = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast); assert(element);
  return evaluate(`globalThis.fieldset = ${element};`, { ...api,
    require: () => ({ jsx, jsxs, Fragment }), isSaving: saving, saveUnconfirmed: unconfirmed,
    activeVisit: visit, editingVisitId: null, completeVisit() {},
  }).fieldset;
}

for (const workflow of workflows) {
  test(`${workflow}: rejected saves permit additions, unresolved saves keep the whole editor locked`, async () => {
    const h = trackingHarness(workflow);
    h.section().onAddBehaviorFromLibrary(h.section().availableLib[0]); h.render();
    h.section().onRecordFrequency(h.section().behaviors[0].id); h.render(); h.section().onSkipIntensity(); h.render();
    const completed = h.complete();
    const p = persistenceHarness(h.api, { writes: [{ error: { code: "23514" }, status: 400, data: null }] });
    p.state.active = completed;
    await p.completeVisit(completed);
    assert.equal(p.state.saving, false); assert.equal(p.state.unconfirmed, false);
    assert.equal(observationFieldset(p.state.saving, p.state.unconfirmed, completed, h.api).props.disabled, false);
    h.section().setCustomBehavior({ label: "Synthetic after rejection", type: "frequency", behaviorType: "positive" });
    h.render(); h.section().onAddCustomBehavior(); h.render();
    await p.completeVisit(h.complete()); await p.fetchPersistedVisits();
    assert.equal(p.state.data.visits[0].behaviors.length, 2);
    assert.equal(p.state.data.visits[0].behaviors[0].count, 1);
    const uncertain = persistenceHarness(h.api, { writes: [new TypeError("Synthetic interrupted save")] });
    const snapshot = h.complete(); uncertain.state.active = snapshot;
    await uncertain.completeVisit(snapshot);
    assert.equal(uncertain.state.unconfirmed, true);
    assert.equal(observationFieldset(false, true, snapshot, h.api).props.disabled, true);
    assert.equal(observationFieldset(true, false, snapshot, h.api).props.disabled, true);
    assert.deepEqual(json(uncertain.context.pendingSnapshot.current.behaviors), json(snapshot.behaviors));
    await uncertain.completeVisit(snapshot);
    assert.equal(uncertain.requests.filter((request) => request.operation === "insert").length, 1);
    assert.equal(uncertain.state.unconfirmed, true, "Unconfirmed saves cannot silently unlock editing");
  });
}

test("FBA: adding during interval tracking preserves targets, records, and countdown", () => {
  const h = intervalHarness(syntheticVisit("fba", intervalBehaviors()));
  h.choose("synthetic-0"); h.record(true); h.choose("synthetic-1"); h.record(false);
  const intervals = json(h.complete().fbaIntervalSessions);
  const countdown = content(h.tree()).match(/Countdown: (\d+)s/)[1];
  h.section().onToggleAddBehavior(); h.render();
  h.section().onAddBehaviorFromLibrary(h.section().availableLib[0]); h.render();
  h.section().setCustomBehavior({ label: "Synthetic interval addition", type: "duration", behaviorType: "positive" });
  h.render(); h.section().onAddCustomBehavior(); h.render();
  assert.equal(content(h.tree()).match(/Countdown: (\d+)s/)[1], countdown);
  assert.deepEqual(json(h.complete().fbaIntervalSessions), intervals);
  h.record(true);
  assert.equal(h.complete().fbaIntervalSessions.find((session) => session.behaviorId === "synthetic-1").records.length, 2);
});
