"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ─── Behavior Library ────────────────────────────────────────────────────────
const BEHAVIOR_LIBRARY = {
  student: [
    // Undesirable / Challenging behaviors
    { id: "disruption", label: "Disruption", type: "frequency", category: "challenging" },
    { id: "defiance", label: "Defiance", type: "frequency", category: "challenging" },
    { id: "work-refusal", label: "Work Refusal", type: "frequency", category: "challenging" },
    { id: "verbal-aggression", label: "Verbal Aggression", type: "frequency", category: "challenging" },
    { id: "physical-aggression", label: "Physical Aggression", type: "frequency", category: "challenging" },
    { id: "elopement", label: "Elopement", type: "frequency", category: "challenging" },
    { id: "meltdown-tantrum", label: "Meltdown / Tantrum", type: "duration", category: "challenging" },
    { id: "off-task", label: "Off-Task", type: "duration", category: "challenging" },
    { id: "negative-peer-interaction", label: "Negative Peer Interaction", type: "frequency", category: "challenging" },
    { id: "self-injurious", label: "Self-Injurious Behavior", type: "frequency", category: "challenging" },
    { id: "property-destruction", label: "Property Destruction", type: "frequency", category: "challenging" },
    { id: "stereotypy", label: "Stereotypy / Self-Stimulatory", type: "duration", category: "challenging" },
    // Desirable / Positive behaviors
    { id: "positive-coping", label: "Positive Coping Strategies", type: "frequency", category: "positive" },
    { id: "self-advocacy", label: "Self-Advocacy", type: "frequency", category: "positive" },
    { id: "task-initiation-no-prompt", label: "Task Initiation (no prompting)", type: "frequency", category: "positive" },
    { id: "task-initiation-min-prompt", label: "Task Initiation (minimal prompting)", type: "frequency", category: "positive" },
    { id: "positive-peer-interaction", label: "Positive Peer Interactions", type: "frequency", category: "positive" },
    { id: "following-directions", label: "Following Directions", type: "frequency", category: "positive" },
    { id: "on-task", label: "On-Task", type: "duration", category: "positive" },
    { id: "task-completion", label: "Task Completion", type: "frequency", category: "positive" },
    { id: "self-regulation", label: "Self-Regulation / Coping Strategy Use", type: "frequency", category: "positive" },
    { id: "raises-hand", label: "Raises Hand / Waits Turn", type: "frequency", category: "positive" },
    { id: "sharing-turns", label: "Sharing / Turn-Taking", type: "frequency", category: "positive" },
    { id: "appropriate-requests", label: "Appropriate Requests for Help", type: "frequency", category: "positive" },
    { id: "verbal-participation", label: "Verbal Participation / Academic Response", type: "frequency", category: "positive" },
  ],
  classroom: [
    // Undesirable behaviors
    { id: "cls-negative-peer", label: "Negative Peer Interactions", type: "frequency", category: "challenging" },
    { id: "cls-off-task", label: "Off-Task", type: "frequency", category: "challenging", measureType: "student-count" },
    { id: "cls-noncompliance", label: "Noncompliance", type: "frequency", category: "challenging" },
    { id: "cls-disruption", label: "Disruption", type: "frequency", category: "challenging" },
    { id: "cls-eloping-seat", label: "Eloping from Seat", type: "frequency", category: "challenging" },
    { id: "cls-eloping-classroom", label: "Eloping from Classroom", type: "frequency", category: "challenging" },
    { id: "cls-property-destruction", label: "Destruction of Property", type: "frequency", category: "challenging" },
    { id: "cls-teacher-redirects", label: "Teacher Redirects", type: "frequency", category: "challenging" },
    // Desirable behaviors
    { id: "cls-positive-peer", label: "Positive Peer Interactions", type: "frequency", category: "positive" },
    { id: "cls-on-task", label: "On-Task", type: "frequency", category: "positive", measureType: "student-count" },
    { id: "cls-participation", label: "Student Participation", type: "frequency", category: "positive", measureType: "student-count" },
    { id: "cls-following-directions", label: "Following Directions", type: "frequency", category: "positive" },
    { id: "cls-coping-strategies", label: "Positive Use of Coping Strategies", type: "frequency", category: "positive" },
    { id: "cls-praise", label: "Praise / Positive Feedback", type: "frequency", category: "positive" },
    { id: "cls-behavior-specific-praise", label: "Behavior-Specific Praise", type: "frequency", category: "positive" },
    { id: "cls-instructional-time", label: "Instructional Time", type: "duration", category: "positive" },
    { id: "cls-smooth-transitions", label: "Smooth / Successful Transitions", type: "frequency", category: "positive" },
  ]
};

const INTENSITY_LEVELS = [
  { value: 1, label: "1 – Mild", color: "#4ade80", desc: "Minimal impact" },
  { value: 2, label: "2 – Moderate", color: "#facc15", desc: "Noticeable disruption" },
  { value: 3, label: "3 – Severe", color: "#f97316", desc: "Significant impact" },
  { value: 4, label: "4 – Crisis", color: "#ef4444", desc: "Immediate intervention" },
];

// ─── Storage helpers ─────────────────────────────────────────────────────────
// ─── Utilities ───────────────────────────────────────────────────────────────
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
function calcRate(freq, durationSec) {
  if (!durationSec) return "—";
  const perMin = (freq / (durationSec / 60)).toFixed(2);
  return `${perMin}/min`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function dateStr(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeStr(ts) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Components ──────────────────────────────────────────────────────────────
function Badge({ color, children }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}55`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.04em", whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function IntensityPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {INTENSITY_LEVELS.map(l => (
        <button key={l.value} onClick={() => onChange(l.value)} style={{
          padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          border: `2px solid ${value === l.value ? l.color : "#333"}`,
          background: value === l.value ? l.color + "33" : "transparent",
          color: value === l.value ? l.color : "#888", cursor: "pointer",
          transition: "all 0.15s"
        }}>{l.label}</button>
      ))}
    </div>
  );
}

// ─── Active Visit Screen ──────────────────────────────────────────────────────
function ActiveVisit({ visit, onComplete, prevVisit }) {
  const totalStudents = visit.totalStudents || null;
  const [elapsed, setElapsed] = useState(0);
  const [behaviors, setBehaviors] = useState(visit.behaviors || []);
  const [durationTimers, setDurationTimers] = useState({});
  const [notes, setNotes] = useState(visit.notes || "");
  const [recommendations, setRecommendations] = useState(visit.recommendations || "");
  const [implStatus, setImplStatus] = useState(visit.implementationStatus || "");
  const [implNotes, setImplNotes] = useState(visit.implementationNotes || "");
  const [showAddBehavior, setShowAddBehavior] = useState(false);
  const [customBehavior, setCustomBehavior] = useState({ label: "", type: "frequency" });
  const startRef = useRef(visit.startTime);
  const timerRef = useRef(null);
  const activeTimers = useRef({});

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Duration timer tick
  useEffect(() => {
    const id = setInterval(() => {
      setDurationTimers(prev => {
        const next = { ...prev };
        Object.keys(activeTimers.current).forEach(bid => {
          if (activeTimers.current[bid]) {
            next[bid] = (next[bid] || 0) + 1;
          }
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleDuration = (bid) => {
    activeTimers.current[bid] = !activeTimers.current[bid];
    setDurationTimers(prev => ({ ...prev })); // force re-render
  };

  const recordFrequency = (bid) => {
    setBehaviors(prev => prev.map(b =>
      b.id === bid ? { ...b, count: (b.count || 0) + 1 } : b
    ));
  };

  const setIntensity = (bid, val) => {
    setBehaviors(prev => prev.map(b =>
      b.id === bid ? { ...b, intensity: val } : b
    ));
  };

  const addBehaviorFromLibrary = (bDef) => {
    if (!behaviors.find(b => b.id === bDef.id)) {
      setBehaviors(prev => [...prev, { ...bDef, count: 0, intensity: null }]);
    }
    setShowAddBehavior(false);
  };

  const addCustomBehavior = () => {
    if (!customBehavior.label.trim()) return;
    const nb = { id: uid(), label: customBehavior.label, type: customBehavior.type, count: 0, intensity: null, custom: true };
    setBehaviors(prev => [...prev, nb]);
    setCustomBehavior({ label: "", type: "frequency" });
    setShowAddBehavior(false);
  };

  const removeBehavior = (bid) => {
    setBehaviors(prev => prev.filter(b => b.id !== bid));
    delete activeTimers.current[bid];
  };

  const handleComplete = () => {
    const finalBehaviors = behaviors.map(b => ({
      ...b,
      durationSec: b.type === "duration" ? (durationTimers[b.id] || 0) : undefined,
    }));
    onComplete({
      ...visit,
      behaviors: finalBehaviors,
      notes,
      recommendations,
      implementationStatus: implStatus,
      implementationNotes: implNotes,
      endTime: Date.now(),
      totalDuration: elapsed
    });
  };

  const libBehaviors = BEHAVIOR_LIBRARY[visit.type] || [];
  const availableLib = libBehaviors.filter(b => !behaviors.find(bb => bb.id === b.id));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 80px" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderRadius: 16, padding: "20px 24px", marginBottom: 20,
        border: "1px solid #334155"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>
              ACTIVE OBSERVATION
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{visit.subjectName}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
              {visit.type === "student" ? "Student" : "Classroom"} • {visit.observerName}
            </div>
            {visit.schoolName && (
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>🏫 {visit.schoolName}</div>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: 36, fontWeight: 900, color: "#38bdf8", fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em", lineHeight: 1
            }}>{fmtTime(elapsed)}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>elapsed</div>
          </div>
        </div>
      </div>

      {/* Implementation follow-up */}
      {prevVisit && prevVisit.recommendations && (
        <div style={{
          background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16,
          border: "1px solid #f59e0b55"
        }}>
          <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>
            ⚡ FOLLOW-UP: Recommendations from {dateStr(prevVisit.endTime || prevVisit.startTime)}
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 12, fontStyle: "italic" }}>
            "{prevVisit.recommendations}"
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Were these recommendations implemented?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: implStatus ? 10 : 0 }}>
            {["fully", "partially", "not"].map(s => (
              <button key={s} onClick={() => setImplStatus(s)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: `2px solid ${implStatus === s ? (s === "fully" ? "#4ade80" : s === "partially" ? "#facc15" : "#f87171") : "#334155"}`,
                background: implStatus === s ? (s === "fully" ? "#4ade8022" : s === "partially" ? "#facc1522" : "#f8717122") : "transparent",
                color: implStatus === s ? (s === "fully" ? "#4ade80" : s === "partially" ? "#facc15" : "#f87171") : "#64748b",
                cursor: "pointer", textTransform: "capitalize"
              }}>{s === "not" ? "Not Implemented" : s.charAt(0).toUpperCase() + s.slice(1) + " Implemented"}</button>
            ))}
          </div>
          {implStatus && (
            <textarea value={implNotes} onChange={e => setImplNotes(e.target.value)}
              placeholder="Optional notes on implementation..." rows={2}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #334155",
                borderRadius: 8, color: "#e2e8f0", padding: "8px 12px", fontSize: 13,
                resize: "none", boxSizing: "border-box", marginTop: 8, fontFamily: "inherit"
              }} />
          )}
        </div>
      )}

      {/* Behaviors */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>BEHAVIORS</div>
          <button onClick={() => setShowAddBehavior(!showAddBehavior)} style={{
            background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: 8,
            padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer"
          }}>+ Add Behavior</button>
        </div>

        {behaviors.length === 0 && (
          <div style={{
            background: "#1e293b", borderRadius: 12, padding: 24, textAlign: "center",
            border: "1px dashed #334155", color: "#475569", fontSize: 14
          }}>No behaviors added yet. Click + Add Behavior to begin.</div>
        )}

        {behaviors.map(b => {
          const isRunning = !!activeTimers.current[b.id];
          const durSec = durationTimers[b.id] || 0;
          return (
            <div key={b.id} style={{
              background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 10,
              border: `1px solid ${isRunning ? "#38bdf855" : "#334155"}`,
              transition: "border-color 0.2s"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{b.label}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                    <Badge color={b.type === "frequency" ? "#818cf8" : "#34d399"}>
                      {b.type === "frequency" ? "Frequency" : "Duration"}
                    </Badge>
                    {b.category === "positive" && <Badge color="#4ade80">❆ Positive</Badge>}
                    {b.category === "challenging" && <Badge color="#f87171">⚠ Challenging</Badge>}
                  </div>
                </div>
                <button onClick={() => removeBehavior(b.id)} style={{
                  background: "none", border: "none", color: "#475569", fontSize: 18,
                  cursor: "pointer", lineHeight: 1, padding: 2
                }}>×</button>
              </div>

              {b.type === "frequency" ? (
                <div style={{ marginBottom: 12 }}>
                  {b.measureType === "student-count" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>NUMBER OF STUDENTS</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button onClick={() => setBehaviors(prev => prev.map(bb => bb.id === b.id ? { ...bb, count: Math.max(0, (bb.count || 0) - 1) } : bb))} style={{
                            background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8,
                            width: 36, height: 36, fontSize: 20, fontWeight: 800, cursor: "pointer", lineHeight: 1
                          }}>−</button>
                          <div style={{ textAlign: "center", minWidth: 50 }}>
                            <div style={{ fontSize: 32, fontWeight: 900, color: "#38bdf8", lineHeight: 1 }}>{b.count || 0}</div>
                            <div style={{ fontSize: 10, color: "#64748b" }}>students</div>
                          </div>
                          <button onClick={() => setBehaviors(prev => prev.map(bb => bb.id === b.id ? { ...bb, count: Math.min(totalStudents || 99, (bb.count || 0) + 1) } : bb))} style={{
                            background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8,
                            width: 36, height: 36, fontSize: 20, fontWeight: 800, cursor: "pointer", lineHeight: 1
                          }}>+</button>
                        </div>
                      </div>
                      {totalStudents && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 26, fontWeight: 900, color: "#f59e0b", lineHeight: 1 }}>
                            {Math.round(((b.count || 0) / totalStudents) * 100)}%
                          </div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>of {totalStudents} students</div>
                        </div>
                      )}
                      {!totalStudents && (
                        <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
                          Add class size at visit setup for % calculation
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <button onClick={() => recordFrequency(b.id)} style={{
                        background: "linear-gradient(135deg, #6366f1, #818cf8)",
                        color: "white", border: "none", borderRadius: 12, padding: "10px 24px",
                        fontSize: 14, fontWeight: 800, cursor: "pointer", minWidth: 100
                      }}>Record (+1)</button>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 32, fontWeight: 900, color: "#818cf8", lineHeight: 1 }}>{b.count || 0}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>occurrences</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{calcRate(b.count || 0, elapsed)}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>rate</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                  <button onClick={() => toggleDuration(b.id)} style={{
                    background: isRunning ? "linear-gradient(135deg, #f97316, #fb923c)" : "linear-gradient(135deg, #34d399, #6ee7b7)",
                    color: isRunning ? "white" : "#0f172a", border: "none", borderRadius: 12,
                    padding: "10px 20px", fontSize: 13, fontWeight: 800, cursor: "pointer", minWidth: 100
                  }}>{isRunning ? "⏹ Stop" : "▶ Start"}</button>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: isRunning ? "#34d399" : "#6ee7b7", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {fmtDuration(durSec)}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>recorded</div>
                  </div>
                  {elapsed > 0 && (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>
                        {Math.round((durSec / elapsed) * 100)}%
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>of visit</div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>INTENSITY</div>
                <IntensityPicker value={b.intensity} onChange={val => setIntensity(b.id, val)} />
              </div>
            </div>
          );
        })}

        {/* Add behavior panel */}
        {showAddBehavior && (
          <div style={{
            background: "#0f172a", borderRadius: 12, padding: 16,
            border: "1px solid #334155", marginTop: 8
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 12 }}>BEHAVIOR LIBRARY</div>
            {availableLib.length === 0 && <div style={{ color: "#475569", fontSize: 13, marginBottom: 16 }}>All library behaviors added.</div>}
            {["positive", "challenging"].map(cat => {
              const catBehaviors = availableLib.filter(b => b.category === cat);
              if (catBehaviors.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6,
                    color: cat === "positive" ? "#4ade80" : "#f87171",
                    letterSpacing: "0.06em"
                  }}>
                    {cat === "positive" ? "✦ POSITIVE BEHAVIORS" : "⚠ CHALLENGING BEHAVIORS"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {catBehaviors.map(b => (
                      <button key={b.id} onClick={() => addBehaviorFromLibrary(b)} style={{
                        background: cat === "positive" ? "#4ade8011" : "#f8717111",
                        border: `1px solid ${cat === "positive" ? "#4ade8044" : "#f8717144"}`,
                        borderRadius: 8,
                        color: "#cbd5e1", padding: "5px 10px", fontSize: 12, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5
                      }}>
                        {b.label}
                        <span style={{ color: b.type === "frequency" ? "#818cf8" : "#34d399", fontSize: 10 }}>
                          {b.type === "frequency" ? "F" : "D"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>CUSTOM BEHAVIOR</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={customBehavior.label} onChange={e => setCustomBehavior(p => ({ ...p, label: e.target.value }))}
                  placeholder="Behavior name..." style={{
                    flex: 1, minWidth: 160, background: "#1e293b", border: "1px solid #334155",
                    borderRadius: 8, color: "#e2e8f0", padding: "8px 12px", fontSize: 13, fontFamily: "inherit"
                  }} />
                <select value={customBehavior.type} onChange={e => setCustomBehavior(p => ({ ...p, type: e.target.value }))} style={{
                  background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
                  color: "#e2e8f0", padding: "8px 12px", fontSize: 13, fontFamily: "inherit"
                }}>
                  <option value="frequency">Frequency</option>
                  <option value="duration">Duration</option>
                </select>
                <button onClick={addCustomBehavior} style={{
                  background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: 8,
                  padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer"
                }}>Add</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notes & Recommendations */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>OBSERVATION NOTES</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Contextual notes..."
            style={{
              width: "100%", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 10, color: "#e2e8f0", padding: "10px 14px", fontSize: 13,
              resize: "none", boxSizing: "border-box", fontFamily: "inherit"
            }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>RECOMMENDATIONS</div>
          <textarea value={recommendations} onChange={e => setRecommendations(e.target.value)} rows={3} placeholder="Interventions or recommendations..."
            style={{
              width: "100%", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 10, color: "#e2e8f0", padding: "10px 14px", fontSize: 13,
              resize: "none", boxSizing: "border-box", fontFamily: "inherit"
            }} />
        </div>
      </div>

      <button onClick={handleComplete} style={{
        width: "100%", background: "linear-gradient(135deg, #10b981, #34d399)",
        color: "#0f172a", border: "none", borderRadius: 12, padding: "16px",
        fontSize: 16, fontWeight: 900, cursor: "pointer", letterSpacing: "0.02em"
      }}>✓ Complete Visit ({fmtTime(elapsed)})</button>
    </div>
  );
}

// ─── Visit Summary Card ───────────────────────────────────────────────────────
function VisitCard({ visit, onClick }) {
  const implColor = visit.implementationStatus === "fully" ? "#4ade80"
    : visit.implementationStatus === "partially" ? "#facc15"
    : visit.implementationStatus === "not" ? "#f87171" : null;

  return (
    <div onClick={onClick} style={{
      background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 10,
      border: "1px solid #334155", cursor: "pointer", transition: "border-color 0.2s"
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#38bdf8"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#334155"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{visit.subjectName}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {dateStr(visit.startTime)} {timeStr(visit.startTime)} · {fmtDuration(visit.totalDuration || 0)} · {visit.observerName}
          </div>
          {visit.schoolName && <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>🏫 {visit.schoolName}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge color={visit.type === "student" ? "#818cf8" : "#f59e0b"}>
            {visit.type === "student" ? "Student" : "Classroom"}
          </Badge>
          {implColor && <Badge color={implColor}>{visit.implementationStatus}</Badge>}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {(visit.behaviors || []).slice(0, 4).map(b => (
          <span key={b.id} style={{
            background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
            padding: "3px 8px", fontSize: 11, color: "#94a3b8"
          }}>{b.label}: {b.type === "frequency" ? `${b.count || 0}×` : fmtDuration(b.durationSec || 0)}</span>
        ))}
        {(visit.behaviors || []).length > 4 && (
          <span style={{ color: "#475569", fontSize: 11, padding: "3px 8px" }}>+{visit.behaviors.length - 4} more</span>
        )}
      </div>
    </div>
  );
}

// ─── Visit Detail Modal ───────────────────────────────────────────────────────
function VisitDetail({ visit, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000cc", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#1e293b", borderRadius: 16, padding: 24, width: "100%",
        maxWidth: 560, maxHeight: "90vh", overflowY: "auto", border: "1px solid #334155"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{visit.subjectName}</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {dateStr(visit.startTime)} · {timeStr(visit.startTime)}–{timeStr(visit.endTime)} · {fmtDuration(visit.totalDuration || 0)}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Observer: {visit.observerName}</div>
            {visit.schoolName && <div style={{ fontSize: 13, color: "#64748b" }}>🏫 {visit.schoolName}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {visit.implementationStatus && (
          <div style={{
            background: "#0f172a", borderRadius: 10, padding: 12, marginBottom: 16,
            border: `1px solid ${visit.implementationStatus === "fully" ? "#4ade8055" : visit.implementationStatus === "partially" ? "#facc1555" : "#f8717155"}`
          }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 4 }}>IMPLEMENTATION FOLLOW-UP</div>
            <div style={{ fontSize: 13, color: "#e2e8f0", textTransform: "capitalize" }}>{visit.implementationStatus} implemented</div>
            {visit.implementationNotes && <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{visit.implementationNotes}</div>}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 10 }}>BEHAVIORS</div>
          {(visit.behaviors || []).map(b => {
            const intLevel = INTENSITY_LEVELS.find(l => l.value === b.intensity);
            return (
              <div key={b.id} style={{
                background: "#0f172a", borderRadius: 10, padding: 12, marginBottom: 8,
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{b.label}</div>
                  <Badge color={b.type === "frequency" ? "#818cf8" : "#34d399"}>{b.type}</Badge>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>
                    {b.type === "frequency"
                      ? (b.measureType === "student-count" ? `${b.count || 0} students` : `${b.count || 0} occurrences`)
                      : fmtDuration(b.durationSec || 0)}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {b.type === "frequency"
                      ? (b.measureType === "student-count" && visit.totalStudents
                          ? `${Math.round(((b.count || 0) / visit.totalStudents) * 100)}% of ${visit.totalStudents} students`
                          : calcRate(b.count || 0, visit.totalDuration))
                      : `${Math.round(((b.durationSec || 0) / (visit.totalDuration || 1)) * 100)}% of visit`}
                  </div>
                  {intLevel && <div style={{ fontSize: 11, color: intLevel.color, marginTop: 2 }}>{intLevel.label}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {visit.notes && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>NOTES</div>
            <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{visit.notes}</div>
          </div>
        )}
        {visit.recommendations && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>RECOMMENDATIONS</div>
            <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{visit.recommendations}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reports View ─────────────────────────────────────────────────────────────
function Reports({ visits }) {
  const [filter, setFilter] = useState("all");
  const [selectedSubject, setSelectedSubject] = useState("all");

  const subjects = [...new Set(visits.map(v => v.subjectName))].sort();
  const filtered = visits.filter(v =>
    (filter === "all" || v.type === filter) &&
    (selectedSubject === "all" || v.subjectName === selectedSubject)
  ).sort((a, b) => b.startTime - a.startTime);

  // Aggregate behavior trends
  const behaviorTrends = {};
  filtered.forEach(v => {
    (v.behaviors || []).forEach(b => {
      if (!behaviorTrends[b.label]) behaviorTrends[b.label] = { total: 0, visits: 0, type: b.type };
      behaviorTrends[b.label].visits++;
      if (b.type === "frequency") behaviorTrends[b.label].total += (b.count || 0);
      else behaviorTrends[b.label].total += (b.durationSec || 0);
    });
  });

  // Implementation stats
  const implStats = { fully: 0, partially: 0, not: 0, none: 0 };
  filtered.forEach(v => {
    if (v.implementationStatus) implStats[v.implementationStatus]++;
    else implStats.none++;
  });
  const totalWithFollowup = implStats.fully + implStats.partially + implStats.not;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 20 }}>Reports & Trends</div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {["all", "student", "classroom"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            border: `2px solid ${filter === f ? "#38bdf8" : "#334155"}`,
            background: filter === f ? "#38bdf822" : "transparent",
            color: filter === f ? "#38bdf8" : "#64748b", cursor: "pointer", textTransform: "capitalize"
          }}>{f === "all" ? "All Types" : f}</button>
        ))}
        <select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} style={{
          background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
          color: "#e2e8f0", padding: "6px 12px", fontSize: 12, fontFamily: "inherit"
        }}>
          <option value="all">All Subjects</option>
          {subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total Visits", value: filtered.length, color: "#38bdf8" },
          { label: "Total Time", value: fmtDuration(filtered.reduce((a, v) => a + (v.totalDuration || 0), 0)), color: "#818cf8" },
          { label: "Unique Subjects", value: [...new Set(filtered.map(v => v.subjectName))].length, color: "#34d399" },
          { label: "With Recommendations", value: filtered.filter(v => v.recommendations).length, color: "#f59e0b" },
        ].map(c => (
          <div key={c.label} style={{
            background: "#1e293b", borderRadius: 12, padding: 14, border: "1px solid #334155"
          }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Implementation effectiveness */}
      {totalWithFollowup > 0 && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 12 }}>INTERVENTION EFFECTIVENESS</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "fully", label: "Fully Implemented", color: "#4ade80" },
              { key: "partially", label: "Partially", color: "#facc15" },
              { key: "not", label: "Not Implemented", color: "#f87171" },
            ].map(s => (
              <div key={s.key} style={{
                flex: 1, minWidth: 100, background: "#0f172a", borderRadius: 10, padding: 12,
                border: `1px solid ${s.color}44`
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{implStats[s.key]}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{s.label}</div>
                <div style={{ fontSize: 10, color: s.color }}>
                  {totalWithFollowup > 0 ? Math.round((implStats[s.key] / totalWithFollowup) * 100) : 0}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Behavior trends */}
      {Object.keys(behaviorTrends).length > 0 && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 12 }}>BEHAVIOR TRENDS</div>
          {Object.entries(behaviorTrends).sort((a, b) => b[1].visits - a[1].visits).map(([label, data]) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 0", borderBottom: "1px solid #0f172a"
            }}>
              <div>
                <div style={{ fontSize: 13, color: "#e2e8f0" }}>{label}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{data.visits} visit{data.visits !== 1 ? "s" : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: data.type === "frequency" ? "#818cf8" : "#34d399" }}>
                  {data.type === "frequency" ? `${data.total} total` : fmtDuration(data.total)}
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  avg {data.type === "frequency"
                    ? `${(data.total / data.visits).toFixed(1)}/visit`
                    : fmtDuration(Math.round(data.total / data.visits))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{
          textAlign: "center", padding: 40, color: "#475569", fontSize: 14,
          background: "#1e293b", borderRadius: 12, border: "1px dashed #334155"
        }}>No visits match the current filters.</div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Page() {
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState("home"); // home | new-visit | active | history | reports
  const [activeVisit, setActiveVisit] = useState(null);
  const [newVisitForm, setNewVisitForm] = useState({ type: "student", subjectName: "", observerName: "", grade: "", totalStudents: "", schoolName: "" });
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [tab, setTab] = useState("home");
  const [implementationStatus, setImplementationStatus] = useState("");

  useEffect(() => {
    (async () => {
      const { data: visits, error } = await supabase
        .from("visits")
        .select("*")
        .order("start_time", { ascending: false });

      if (error) {
        console.error(error);
        setData({ visits: [], subjects: [] });
        return;
      }

      const mappedVisits = (visits || []).map((v) => {
        const start = v.start_time ?? v.startTime;
        const end = v.end_time ?? v.endTime;

        return {
          ...v,
          subjectName: v.subject_name ?? v.subjectName,
          observerName: v.observer_name ?? v.observerName,
          startTime: typeof start === "number" ? start : start ? new Date(start).getTime() : null,
          endTime: typeof end === "number" ? end : end ? new Date(end).getTime() : null,
          totalDuration: v.total_duration ?? v.totalDuration,
        };
      });

      setData({ visits: mappedVisits, subjects: [] });
    })();
  }, []);

  const persistData = useCallback((d) => {
    setData(d);
  }, []);

  const startVisit = () => {
    if (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim()) return;
    if (!implementationStatus) return;

    // Find previous visits for this subject
    const prevVisits = (data?.visits || []).filter(v =>
      v.subjectName.toLowerCase() === newVisitForm.subjectName.toLowerCase() && v.type === newVisitForm.type
    ).sort((a, b) => b.startTime - a.startTime);

    const prevBehaviors = prevVisits.length > 0
      ? prevVisits[0].behaviors.map(b => ({ ...b, count: 0, intensity: null, durationSec: undefined }))
      : [];

    const visit = {
      id: uid(),
      type: newVisitForm.type,
      subjectName: newVisitForm.subjectName.trim(),
      observerName: newVisitForm.observerName.trim(),
      grade: newVisitForm.grade,
      schoolName: newVisitForm.schoolName.trim(),
      totalStudents: newVisitForm.type === "classroom" ? (parseInt(newVisitForm.totalStudents) || null) : null,
      startTime: Date.now(),
      behaviors: prevBehaviors,
      implementationStatus,
      prevVisit: prevVisits[0] || null
    };
    setActiveVisit(visit);
    setScreen("active");
  };

  const completeVisit = (completedVisit) => {
    const updated = { ...data, visits: [...(data?.visits || []), completedVisit] };

    setData(updated);

    (async () => {
      const visitObject = {
        id: crypto.randomUUID(),
        subject_name: completedVisit.subjectName,
        observer_name: completedVisit.observerName,
        type: completedVisit.type ?? "",
        school_name: completedVisit.schoolName ?? "",
        grade: completedVisit.grade ?? "",
        total_students: completedVisit.totalStudents ?? 0,
        implementation_status: completedVisit.implementationStatus ?? implementationStatus,
        start_time: completedVisit.startTime ? new Date(completedVisit.startTime).getTime() : null,
        end_time: completedVisit.endTime ? new Date(completedVisit.endTime).getTime() : null,
        total_duration: completedVisit.totalDuration ?? null,
        behaviors: completedVisit.behaviors ?? [],
      };

      const { data, error } = await supabase
        .from("visits")
        .insert([visitObject])
        .select();

      console.log("Insert data:", data);

      if (error) {
        console.error("Supabase error message:", error.message);
        console.error("Supabase error details:", error.details);
        console.error("Supabase error hint:", error.hint);
        console.error("Full error object:", JSON.stringify(error, null, 2));
      }
    })();

    setActiveVisit(null);
    setScreen("home");
    setTab("home");
    setNewVisitForm({ type: "student", subjectName: "", observerName: "", grade: "", totalStudents: "", schoolName: "" });
    setImplementationStatus("");
  };

  const allVisits = (data?.visits || []).sort((a, b) => b.startTime - a.startTime);

  if (!data) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0f172a", display: "flex",
        alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 16
      }}>Loading...</div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a", color: "#e2e8f0",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Top bar */}
      <div style={{
        background: "#0f172a", borderBottom: "1px solid #1e293b",
        padding: "14px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", position: "sticky", top: 0, zIndex: 50
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #38bdf8, #818cf8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16
          }}>👁</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>InMind Observer</div>
            <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1 }}>Behavior Tracking</div>
          </div>
        </div>
        {screen === "active" && (
          <div style={{ fontSize: 12, color: "#f97316", fontWeight: 700, background: "#f9731622",
            padding: "4px 10px", borderRadius: 20, border: "1px solid #f9731644" }}>
            ● LIVE
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 16px", maxWidth: 720, margin: "0 auto" }}>

        {/* Active visit */}
        {screen === "active" && activeVisit && (
          <ActiveVisit
            visit={activeVisit}
            prevVisit={activeVisit.prevVisit}
            onComplete={completeVisit}
          />
        )}

        {/* New visit form */}
        {screen === "new-visit" && (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
              <button onClick={() => { setImplementationStatus(""); setScreen("home"); setTab("home"); }} style={{
                background: "none", border: "1px solid #334155", color: "#94a3b8",
                borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer"
              }}>← Back</button>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>New Visit</div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {["student", "classroom"].map(t => (
                <button key={t} onClick={() => setNewVisitForm(p => ({ ...p, type: t }))} style={{
                  flex: 1, padding: "12px", borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${newVisitForm.type === t ? "#38bdf8" : "#334155"}`,
                  background: newVisitForm.type === t ? "#38bdf822" : "#1e293b",
                  color: newVisitForm.type === t ? "#38bdf8" : "#64748b", cursor: "pointer",
                  textTransform: "capitalize"
                }}>{t === "student" ? "👤 Student" : "🏫 Classroom"}</button>
              ))}
            </div>

            {[
              { key: "subjectName", label: newVisitForm.type === "student" ? "Student Name" : "Classroom / Teacher", placeholder: newVisitForm.type === "student" ? "e.g. Alex M." : "e.g. Ms. Johnson – Room 12" },
              { key: "observerName", label: "Observer Name", placeholder: "Your name" },
              { key: "grade", label: "Grade / Setting (optional)", placeholder: "e.g. 3rd grade" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>{f.label.toUpperCase()}</div>
                <input value={newVisitForm[f.key]} onChange={e => setNewVisitForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder} style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }} />
              </div>
            ))}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>SCHOOL NAME</div>
              <input
                value={newVisitForm.schoolName}
                onChange={e => setNewVisitForm(p => ({ ...p, schoolName: e.target.value }))}
                placeholder="e.g. Lincoln Elementary"
                style={{
                  width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                  color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                  fontFamily: "inherit"
                }} />
            </div>

            {newVisitForm.type === "classroom" && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>TOTAL STUDENTS IN CLASS</div>
                <input
                  type="number" min="1" max="50"
                  value={newVisitForm.totalStudents}
                  onChange={e => setNewVisitForm(p => ({ ...p, totalStudents: e.target.value }))}
                  placeholder="e.g. 22"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #f59e0b88", borderRadius: 10,
                    color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }} />
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  Used to calculate % of students for On-Task, Off-Task, and Student Participation
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
                Did the teacher implement previous feedback/interventions?
              </div>
              <select
                value={implementationStatus}
                onChange={e => setImplementationStatus(e.target.value)}
                style={{
                  width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                  color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                  fontFamily: "inherit"
                }}
              >
                <option value="">Select…</option>
                <option value="fully">Yes</option>
                <option value="not">No</option>
                <option value="partially">Partially</option>
              </select>
            </div>

            {/* Prior visits hint */}
            {newVisitForm.subjectName.trim() && (() => {
              const prior = allVisits.filter(v =>
                v.subjectName.toLowerCase() === newVisitForm.subjectName.toLowerCase().trim() && v.type === newVisitForm.type
              );
              return prior.length > 0 ? (
                <div style={{
                  background: "#1e293b", borderRadius: 10, padding: 12, marginBottom: 14,
                  border: "1px solid #38bdf844"
                }}>
                  <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: 700, marginBottom: 4 }}>
                    ✓ {prior.length} prior visit{prior.length !== 1 ? "s" : ""} found
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    Previous behaviors will be pre-loaded. Last visit: {dateStr(prior[0].startTime)}
                    {prior[0].recommendations && " · Has recommendations for follow-up"}
                  </div>
                </div>
              ) : null;
            })()}

            <button onClick={startVisit}
              disabled={!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !implementationStatus}
              style={{
                width: "100%", background: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !implementationStatus)
                  ? "#1e293b" : "linear-gradient(135deg, #38bdf8, #818cf8)",
                color: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !implementationStatus) ? "#475569" : "#0f172a",
                border: "none", borderRadius: 12, padding: "16px", fontSize: 16, fontWeight: 900,
                cursor: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !implementationStatus) ? "not-allowed" : "pointer"
              }}>▶ Start Observation</button>
          </div>
        )}

        {/* Home / history / reports tabs */}
        {(screen === "home" || screen === "history" || screen === "reports") && (
          <>
            {/* Tab bar */}
            <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#1e293b", borderRadius: 12, padding: 4 }}>
              {[
                { id: "home", label: "Home" },
                { id: "history", label: `History (${allVisits.length})` },
                { id: "reports", label: "Reports" },
              ].map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); setScreen(t.id === "home" ? "home" : t.id); }} style={{
                  flex: 1, padding: "8px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                  border: "none",
                  background: tab === t.id ? "#0f172a" : "transparent",
                  color: tab === t.id ? "#f1f5f9" : "#64748b", cursor: "pointer"
                }}>{t.label}</button>
              ))}
            </div>

            {/* Home */}
            {tab === "home" && (
              <div>
                <button onClick={() => { setImplementationStatus(""); setScreen("new-visit"); setTab(""); }} style={{
                  width: "100%", background: "linear-gradient(135deg, #38bdf8, #818cf8)",
                  color: "#0f172a", border: "none", borderRadius: 14, padding: "20px",
                  fontSize: 18, fontWeight: 900, cursor: "pointer", marginBottom: 24,
                  boxShadow: "0 4px 20px #38bdf844"
                }}>+ Start New Observation</button>

                {allVisits.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>RECENT VISITS</div>
                    {allVisits.slice(0, 5).map(v => (
                      <VisitCard key={v.id} visit={v} onClick={() => setSelectedVisit(v)} />
                    ))}
                    {allVisits.length > 5 && (
                      <button onClick={() => { setTab("history"); setScreen("history"); }} style={{
                        width: "100%", background: "none", border: "1px solid #334155",
                        color: "#64748b", borderRadius: 10, padding: "10px", fontSize: 13, cursor: "pointer", marginTop: 4
                      }}>View all {allVisits.length} visits →</button>
                    )}
                  </>
                )}

                {allVisits.length === 0 && (
                  <div style={{
                    textAlign: "center", padding: "48px 24px", color: "#475569",
                    background: "#1e293b", borderRadius: 14, border: "1px dashed #334155"
                  }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#64748b" }}>No visits yet</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>Start your first observation above.</div>
                  </div>
                )}
              </div>
            )}

            {/* History */}
            {tab === "history" && (
              <div>
                {allVisits.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>No visits recorded yet.</div>
                ) : (
                  allVisits.map(v => <VisitCard key={v.id} visit={v} onClick={() => setSelectedVisit(v)} />)
                )}
              </div>
            )}

            {/* Reports */}
            {tab === "reports" && <Reports visits={allVisits} />}
          </>
        )}
      </div>

      {/* Visit detail modal */}
      {selectedVisit && <VisitDetail visit={selectedVisit} onClose={() => setSelectedVisit(null)} />}
    </div>
  );
}
