import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
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
  ...["uid", "fmtTime", "fmtDuration", "calcRate", "Badge", "IntensityPicker", "normalizeBehaviorList",
    "resetBehaviorForNewVisit", "appendBehaviorOccurrence", "setBehaviorOccurrenceIntensity",
    "BehaviorSetupSection", "ActiveVisit", "ActiveFbaVisit"].map(functionSource),
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
    useBehaviorDurationTimer() {}, ObservationDurationEditor() { return null; },
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
function persistenceHarness(api) {
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
  for (const count of [1, 3, 4, 6, 10]) {
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
  test(`${workflow}: subsequent observations preserve eligible configurations and reset measurements`, async () => {
    const h = trackingHarness(workflow), p = persistenceHarness(h.api);
    const type = workflow === "rhs9" ? "classroom" : workflow;
    const library = h.api.BEHAVIOR_LIBRARY[type === "fba" ? "student" : type];
    // The reported three-library/seven-custom case must retain all ten selections.
    const behaviors = [...library.slice(0, 3), ...Array.from({ length: 7 }, (_, index) => ({
      id: `synthetic-custom-${index}`, label: `Synthetic ${index}`, custom: true,
      type: index % 2 ? "duration" : "frequency", category: index % 2 ? "challenging" : "positive",
      supportsDuration: true, supportsStudentCount: true, measureType: "student-count",
    }))].map((item) => ({ ...item, count: 5, studentCount: 9, durationSec: 30, intensity: 4,
      occurrences: [{ timestamp: 1000, intensity: 4 }], intensityRecords: [{ timestamp: 1000, intensity: 4 }], note: "Synthetic previous note" }));
    const previous = syntheticVisit(workflow, behaviors);
    const original = json(previous);
    await p.completeVisit(previous);
    await p.fetchPersistedVisits();
    assert.equal(p.state.data.visits[0].behaviors.length, 10, "Mixed library/custom selections survive saving and loading");
    p.context.data = p.state.data;
    p.context.newVisitForm = { type, subjectName: previous.subjectName, observerName: previous.observerName,
      grade: previous.grade, selectedDistrict: previous.district, schoolName: previous.schoolName };
    p.startVisit();
    assert.equal(p.state.active.behaviors.length, workflow === "fba" ? 0 : 10);
    for (const behavior of p.state.active.behaviors) {
      const saved = previous.behaviors.find((item) => item.id === behavior.id);
      for (const key of ["id", "label", "category", "type", "custom", "measureType", "supportsDuration", "supportsStudentCount"]) {
        assert.equal(behavior[key], saved[key], `Preserve ${key}`);
      }
      assert.equal(behavior.count, 0); assert.equal(behavior.studentCount, 0);
      assert.equal(behavior.durationSec, 0); assert.equal(behavior.intensity, null);
      assert.equal(behavior.note, "");
      assert.deepEqual(json(behavior.occurrences), []); assert.deepEqual(json(behavior.intensityRecords), []);
    }
    assert.deepEqual(json(previous), original, "Original observation is unchanged");
    assert.deepEqual(p.rows.get(previous.id).behaviors, original.behaviors, "Stored measurements remain intact");
    const next = trackingHarness(workflow, { visit: p.state.active });
    next.section().onAddBehaviorFromLibrary(next.section().availableLib[0]); next.render();
    assert.equal(next.section().behaviors.length, workflow === "fba" ? 1 : 11,
      "Subsequent observations still permit additional behaviors");
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
      assert.equal(p.state.active.prevVisit, null);
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

test("challenging-behavior intensity overlay clears with Skip, preserving every selection", () => {
  const h = trackingHarness("student");
  for (let index = 0; index < 4; index++) {
    h.section().onAddBehaviorFromLibrary(h.section().availableLib.find((item) => item.category === "challenging" && item.type === "frequency")); h.render();
  }
  h.section().onRecordFrequency(h.section().behaviors[3].id); h.render();
  assert(nodes(h.shared()).some((node) => node.props?.style?.position === "fixed" && node.props.style.zIndex === 120));
  assert(h.section().pendingIntensity);
  h.section().onSkipIntensity(); h.render();
  assert.equal(h.section().pendingIntensity, null);
  assert.equal(h.section().behaviors.length, 4);
  assert.equal(h.section().behaviors[3].count, 1);
});
