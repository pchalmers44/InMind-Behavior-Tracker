"use client";

import { Suspense, useState, useEffect, useRef, useCallback, useMemo, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { GRADE_OPTIONS } from "@/lib/grades";
import {
  buildIntensityTrendLabel,
  getBehaviorIntensityStats,
  normalizeBehaviorOccurrences,
  type BehaviorOccurrence,
} from "@/lib/behavior-intensity";

type Behavior = {
  id: string;
  label: string;
  type: string;
  category?: BehaviorType;
  measureType?: string;
  count?: number;
  intensity?: number | null;
  occurrences?: BehaviorOccurrence[];
  intensityRecords?: BehaviorOccurrence[];
  durationSec?: number;
  custom?: boolean;
  [key: string]: any;
};

type BehaviorType = "positive" | "challenging";

type AbcEntry = { antecedent: string; behavior: string; consequence: string };

type FbaLatencyEvent = {
  behaviorId: string | null;
  behaviorLabel: string;
  startTime: number;
  stopTime: number;
  latencySec: number;
  timestamp: number; // record created at
};

type FbaIntervalRecord = {
  intervalNumber: number;
  behaviorPresent: boolean;
  timestamp: number;
};

type FbaIntervalSession = {
  behaviorId: string | null;
  behaviorLabel: string;
  intervalLengthSec: number;
  records: FbaIntervalRecord[];
  startedAt: number;
};

type Visit = {
  id: string;
  type: "student" | "classroom" | "fba";
  subjectName: string;
  observerName: string;
  grade?: string;
  isFirstVisit?: boolean;
  district?: string;
  schoolName?: string;
  totalStudents?: number | null;
  startTime: number;
  endTime?: number | null;
  totalDuration?: number | null;
  behaviors?: Behavior[];
  abcEntries?: AbcEntry[];
  latencyRecords?: number[];
  fbaLatencyEvents?: FbaLatencyEvent[];
  intervalLengthSec?: number | null;
  intervalRecords?: boolean[];
  fbaIntervalSessions?: FbaIntervalSession[];
  notes?: string;
  recommendations?: string;
  implementationStatus?: string;
  implementationNotes?: string;
  updatedAt?: string | number | null;
  prevVisit?: Visit | null;
  [key: string]: any;
};

type DataState = {
  visits: Visit[];
  subjects: string[];
};

type ReportScope = "district" | "school";
type ReportDatePreset = "last7" | "last30" | "last90" | "schoolYear" | "custom";

type NewVisitFormState = {
  type: "student" | "classroom" | "fba";
  subjectName: string;
  observerName: string;
  grade: string;
  totalStudents: string;
  selectedDistrict: string;
  customDistrict: string;
  schoolName: string;
  isFirstVisit?: boolean;
};

// --- Behavior Library ---
const BEHAVIOR_LIBRARY = {
  student: [
    // Undesirable / Challenging behaviors
    { id: "disruption", label: "Disruption", type: "frequency", category: "challenging" },
    { id: "work-refusal", label: "Work Refusal", type: "frequency", category: "challenging" },
    { id: "verbal-aggression", label: "Verbal Aggression", type: "frequency", category: "challenging" },
    { id: "physical-aggression", label: "Physical Aggression", type: "frequency", category: "challenging" },
    { id: "elopement", label: "Elopement", type: "frequency", category: "challenging" },
    { id: "meltdown-tantrum", label: "Meltdown / Tantrum", type: "duration", category: "challenging" },
    { id: "off-task", label: "Off-Task", type: "duration", category: "challenging" },
    { id: "negative-peer-interaction", label: "Negative Peer Interaction", type: "frequency", category: "challenging" },
    { id: "self-injurious", label: "Self-Injurious Behavior", type: "frequency", category: "challenging" },
    { id: "property-destruction", label: "Property Destruction", type: "frequency", category: "challenging" },
    // Desirable / Positive behaviors
    { id: "positive-coping", label: "Positive Coping Strategies", type: "frequency", category: "positive" },
    { id: "self-advocacy", label: "Self-Advocacy", type: "frequency", category: "positive" },
    { id: "task-initiation-no-prompt", label: "Task Initiation (no prompting)", type: "frequency", category: "positive" },
    { id: "task-initiation-min-prompt", label: "Task Initiation (minimal prompting)", type: "frequency", category: "positive" },
    { id: "positive-peer-interaction", label: "Positive Peer Interactions", type: "frequency", category: "positive" },
    { id: "following-directions", label: "Following Directions", type: "frequency", category: "positive" },
    { id: "on-task", label: "On-Task", type: "duration", category: "positive" },
    { id: "task-completion", label: "Task Completion", type: "frequency", category: "positive" },
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
    { id: "cls-following-directions", label: "Following Directions", type: "frequency", category: "positive" },
    { id: "cls-coping-strategies", label: "Positive Use of Coping Strategies", type: "frequency", category: "positive" },
    { id: "cls-praise", label: "Praise / Positive Feedback", type: "frequency", category: "positive" },
    { id: "cls-behavior-specific-praise", label: "Behavior-Specific Praise", type: "frequency", category: "positive" },
    { id: "cls-smooth-transitions", label: "Smooth / Successful Transitions", type: "frequency", category: "positive" },
  ]
};

const districtSchoolMap: Record<string, readonly string[]> = {
  "Reading School District": [
    "Reading High School",
    "Innovation Academy",
    "RKAA City Line",
    "RKAA Glenside",
    "RKAA Thomas Ford",
    "Central Middle School",
    "Northeast Middle School",
    "Northwest Middle School",
    "Southern Middle School",
    "Southwest Middle School",
    "10th and Green Elementary",
    "10th and Penn Elementary",
    "12th and Marion Elementary",
    "13th and Green Elementary",
    "13th and Union Elementary",
    "16th and Haak Elementary",
    "Amanda E. Stout Elementary",
    "Glenside Elementary",
    "Lauer's Park Elementary",
    "Millmont Elementary",
    "Northwest Area Elementary",
    "Riverside Elementary",
    "Tyson-Schoener Elementary",
  ],
  "Colonial School District": [
    "Colonial Elementary School",
    "Conshohocken Elementary School",
    "Plymouth Elementary School",
    "Ridge Park Elementary School",
    "Whitemarsh Elementary School",
    "Colonial Middle School",
    "Plymouth Whitemarsh High School",
  ],
  "Belmont Charter School": [
    "Inquiry Charter School",
    "Belmont Academy Charter School",
    "Belmont Charter Elementary School",
    "Belmont Middle School",
    "Belmont High School",
  ],
  "Independence Mission School": [
    "St. Barnabus",
    "SS. Cyril and Philomena",
    "St. Frances Cabrini",
    "The DePaul Catholic School",
    "St. Helena-Incarnation",
    "Holy Cross Catholic School",
    "St. Malachy",
    "St. Martin de Porres",
    "St. Martin of Tours",
    "Our Mother of Sorrows St. Ignatius",
    "St. Raymond",
    "St. Rose of Lima",
    "St. Thomas Aquinas",
    "St. Veronica",
  ],
  "Green Woods Charter School": ["Green Woods Charter School"],
};

const DISTRICT_OPTIONS = [...Object.keys(districtSchoolMap), "Other"];

const INTENSITY_LEVELS = [
  { value: 1, label: "1 - Mild", color: "#4ade80", desc: "Minimal impact" },
  { value: 2, label: "2 - Moderate", color: "#facc15", desc: "Noticeable disruption" },
  { value: 3, label: "3 - Severe", color: "#f97316", desc: "Significant impact" },
  { value: 4, label: "4 - Crisis", color: "#ef4444", desc: "Immediate intervention" },
];

// --- Utilities ---
function fmtTime(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDuration(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
function calcRate(freq: number, durationSec: number) {
  if (!durationSec) return "-";
  const perMin = (freq / (durationSec / 60)).toFixed(2);
  return `${perMin}/min`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function dateStr(ts: number | string | Date | null | undefined) {
  return new Date(ts as any).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeStr(ts: number | string | Date | null | undefined) {
  return new Date(ts as any).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// --- Components ---
function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}55`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.04em", whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function IntensityPicker({ value, onChange }: { value: number | null | undefined; onChange: (val: number) => void }) {
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

type PendingIntensityPrompt = {
  behaviorId: string;
  behaviorLabel: string;
  occurrenceType: "frequency" | "duration";
  timestamp: number;
  durationSec?: number;
};

type BehaviorSetupSectionProps = {
  behaviors: Behavior[];
  availableLib: Behavior[];
  showAddBehavior: boolean;
  onToggleAddBehavior: () => void;
  customBehavior: { label: string; type: string; behaviorType?: BehaviorType };
  setCustomBehavior: Dispatch<SetStateAction<{ label: string; type: string; behaviorType?: BehaviorType }>>;
  setBehaviors: Dispatch<SetStateAction<Behavior[]>>;
  onAddBehaviorFromLibrary: (bDef: Behavior) => void;
  onAddCustomBehavior: () => void;
  onRemoveBehavior: (bid: string) => void;
  onRecordFrequency: (bid: string) => void;
  onToggleDuration: (bid: string) => void;
  pendingIntensity: PendingIntensityPrompt | null;
  onChooseIntensity: (val: number) => void;
  onSkipIntensity: () => void;
  durationTimers: Record<string, number>;
  setDurationTimers: Dispatch<SetStateAction<Record<string, number>>>;
  activeTimers: MutableRefObject<Record<string, boolean>>;
  elapsed: number;
  totalStudents?: number | null;
};

function useBehaviorDurationTimer(
  activeTimers: MutableRefObject<Record<string, boolean>>,
  setDurationTimers: Dispatch<SetStateAction<Record<string, number>>>
) {
  useEffect(() => {
    const id = setInterval(() => {
      setDurationTimers((prev) => {
        const next = { ...prev };
        Object.keys(activeTimers.current).forEach((bid) => {
          if (activeTimers.current[bid]) {
            next[bid] = (next[bid] || 0) + 1;
          }
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [activeTimers, setDurationTimers]);
}

function BehaviorSetupSection({
  behaviors,
  availableLib,
  showAddBehavior,
  onToggleAddBehavior,
  customBehavior,
  setCustomBehavior,
  setBehaviors,
  onAddBehaviorFromLibrary,
  onAddCustomBehavior,
  onRemoveBehavior,
  onRecordFrequency,
  onToggleDuration,
  pendingIntensity,
  onChooseIntensity,
  onSkipIntensity,
  durationTimers,
  setDurationTimers,
  activeTimers,
  elapsed,
  totalStudents,
}: BehaviorSetupSectionProps) {
  const updateFrequencyCount = (behaviorId: string, nextCount: number) => {
    const count = Math.max(0, Math.floor(Number.isFinite(nextCount) ? nextCount : 0));
    setBehaviors((prev) =>
      prev.map((behavior) => {
        if (behavior.id !== behaviorId) return behavior;
        const occurrences = normalizeBehaviorOccurrences(behavior);
        const nextOccurrences =
          count > occurrences.length
            ? [
                ...occurrences,
                ...Array.from({ length: count - occurrences.length }, () => ({
                  intensity: null,
                  timestamp: Date.now() + Math.random(),
                })),
              ]
            : occurrences.slice(0, count);
        return {
          ...behavior,
          count,
          occurrences: nextOccurrences,
          intensity: nextOccurrences.length ? nextOccurrences[nextOccurrences.length - 1].intensity ?? null : null,
        };
      })
    );
  };

  const updateDurationSeconds = (behaviorId: string, nextDurationSec: number) => {
    const durationSec = Math.max(0, Math.floor(Number.isFinite(nextDurationSec) ? nextDurationSec : 0));
    setDurationTimers((prev) => ({ ...prev, [behaviorId]: durationSec }));
    setBehaviors((prev) => prev.map((behavior) => (behavior.id === behaviorId ? { ...behavior, durationSec } : behavior)));
  };

  const updateOccurrenceIntensity = (behaviorId: string, timestamp: number, intensity: number | null) => {
    setBehaviors((prev) =>
      prev.map((behavior) =>
        behavior.id === behaviorId ? setBehaviorOccurrenceIntensity(behavior, timestamp, intensity) : behavior
      )
    );
  };

  const removeOccurrence = (behaviorId: string, timestamp: number) => {
    setBehaviors((prev) =>
      prev.map((behavior) => {
        if (behavior.id !== behaviorId) return behavior;
        const occurrences = normalizeBehaviorOccurrences(behavior).filter((record) => record.timestamp !== timestamp);
        return {
          ...behavior,
          count: behavior.type === "frequency" && behavior.measureType !== "student-count" ? occurrences.length : behavior.count,
          occurrences,
          intensity: occurrences.length ? occurrences[occurrences.length - 1].intensity ?? null : null,
        };
      })
    );
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>BEHAVIORS</div>
        <button
          onClick={onToggleAddBehavior}
          style={{
            background: "#38bdf8",
            color: "#0f172a",
            border: "none",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          + Add Behavior
        </button>
      </div>

      {behaviors.length === 0 && (
        <div
          style={{
            background: "#1e293b",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            border: "1px dashed #334155",
            color: "#475569",
            fontSize: 14,
          }}
        >
          No behaviors added yet. Click + Add Behavior to begin.
        </div>
      )}

      {behaviors.map((b) => {
        const isRunning = !!activeTimers.current[b.id];
        const durSec = durationTimers[b.id] || 0;
        const intensityStats = getBehaviorIntensityStats(b);
        const intensityBlocked = Boolean(pendingIntensity) && b.category === "challenging";
        return (
          <div
            key={b.id}
            style={{
              background: "#1e293b",
              borderRadius: 12,
              padding: 16,
              marginBottom: 10,
              border: `1px solid ${isRunning ? "#38bdf855" : "#334155"}`,
              transition: "border-color 0.2s",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{b.label}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                  <Badge color={b.type === "frequency" ? "#818cf8" : "#34d399"}>
                    {b.type === "frequency"
                      ? (b.measureType === "student-count" ? "Student Count" : "Frequency")
                      : "Duration"}
                  </Badge>
                  {b.category === "positive" && <Badge color="#4ade80">Positive</Badge>}
                  {b.category === "challenging" && <Badge color="#f87171">Challenging</Badge>}
                </div>
              </div>
              <button
                onClick={() => onRemoveBehavior(b.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#475569",
                  fontSize: 18,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: 2,
                }}
              >
                x
              </button>
            </div>

            {b.type === "frequency" ? (
              <div style={{ marginBottom: 12 }}>
                {b.measureType === "student-count" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                        {b.id === "cls-on-task"
                          ? "Number of Students On Task"
                          : b.id === "cls-off-task"
                            ? "Number of Students Off Task"
                            : "Number of Students"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={() =>
                            setBehaviors((prev) =>
                              prev.map((bb) => (bb.id === b.id ? { ...bb, count: Math.max(0, (bb.count || 0) - 1) } : bb))
                            )
                          }
                          style={{
                            background: "#334155",
                            color: "#e2e8f0",
                            border: "none",
                            borderRadius: 8,
                            width: 36,
                            height: 36,
                            fontSize: 20,
                            fontWeight: 800,
                            cursor: "pointer",
                            lineHeight: 1,
                          }}
                        >
                          -
                        </button>
                        <div style={{ textAlign: "center", minWidth: 50 }}>
                          <div style={{ fontSize: 32, fontWeight: 900, color: "#38bdf8", lineHeight: 1 }}>{b.count || 0}</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>students</div>
                        </div>
                        <button
                          onClick={() =>
                            setBehaviors((prev) =>
                              prev.map((bb) =>
                                bb.id === b.id ? { ...bb, count: Math.min(totalStudents || 99, (bb.count || 0) + 1) } : bb
                              )
                            )
                          }
                          style={{
                            background: "#334155",
                            color: "#e2e8f0",
                            border: "none",
                            borderRadius: 8,
                            width: 36,
                            height: 36,
                            fontSize: 20,
                            fontWeight: 800,
                            cursor: "pointer",
                            lineHeight: 1,
                          }}
                        >
                          +
                        </button>
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
                    <button
                      onClick={() => updateFrequencyCount(b.id, (b.count || 0) - 1)}
                      disabled={intensityBlocked || (b.count || 0) <= 0}
                      style={{
                        background: intensityBlocked || (b.count || 0) <= 0 ? "#0f172a" : "#334155",
                        color: intensityBlocked || (b.count || 0) <= 0 ? "#475569" : "#e2e8f0",
                        border: "none",
                        borderRadius: 12,
                        padding: "10px 14px",
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: intensityBlocked || (b.count || 0) <= 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      -1
                    </button>
                    <button
                      onClick={() => onRecordFrequency(b.id)}
                      disabled={intensityBlocked}
                      style={{
                        background: intensityBlocked ? "#0f172a" : "linear-gradient(135deg, #6366f1, #818cf8)",
                        color: intensityBlocked ? "#475569" : "white",
                        border: "none",
                        borderRadius: 12,
                        padding: "10px 24px",
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: intensityBlocked ? "not-allowed" : "pointer",
                        minWidth: 100,
                      }}
                    >
                      Record (+1)
                    </button>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, fontWeight: 900, color: "#818cf8", lineHeight: 1 }}>{b.count || 0}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>occurrences</div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={b.count || 0}
                      onChange={(e) => updateFrequencyCount(b.id, parseInt(e.target.value || "0", 10))}
                      disabled={intensityBlocked}
                      aria-label={`${b.label} occurrences`}
                      style={{
                        width: 88,
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 10,
                        color: intensityBlocked ? "#475569" : "#e2e8f0",
                        padding: "9px 10px",
                        fontSize: 13,
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{calcRate(b.count || 0, elapsed)}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>rate</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <button
                  onClick={() => onToggleDuration(b.id)}
                  disabled={intensityBlocked}
                  style={{
                    background: intensityBlocked
                      ? "#0f172a"
                      : isRunning
                        ? "linear-gradient(135deg, #f97316, #fb923c)"
                        : "linear-gradient(135deg, #34d399, #6ee7b7)",
                    color: intensityBlocked ? "#475569" : isRunning ? "white" : "#0f172a",
                    border: "none",
                    borderRadius: 12,
                    padding: "10px 20px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: intensityBlocked ? "not-allowed" : "pointer",
                    minWidth: 100,
                  }}
                >
                  {isRunning ? "Stop" : "Start"}
                </button>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 900,
                      color: isRunning ? "#34d399" : "#6ee7b7",
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtDuration(durSec)}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>recorded</div>
                </div>
                <input
                  type="number"
                  min={0}
                  value={durSec}
                  onChange={(e) => updateDurationSeconds(b.id, parseInt(e.target.value || "0", 10))}
                  disabled={intensityBlocked}
                  aria-label={`${b.label} duration seconds`}
                  style={{
                    width: 104,
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 10,
                    color: intensityBlocked ? "#475569" : "#e2e8f0",
                    padding: "9px 10px",
                    fontSize: 13,
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
                {elapsed > 0 && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{Math.round((durSec / elapsed) * 100)}%</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>of visit</div>
                  </div>
                )}
              </div>
            )}

            {b.category === "challenging" && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>INTENSITY SUMMARY</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                  <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>OCCURRENCES</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#f1f5f9", marginTop: 2 }}>{intensityStats.totalOccurrences}</div>
                  </div>
                  <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>AVERAGE</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#f1f5f9", marginTop: 2 }}>
                      {intensityStats.averageIntensity != null ? intensityStats.averageIntensity.toFixed(1) : "-"}
                    </div>
                  </div>
                  <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>HIGHEST</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#f1f5f9", marginTop: 2 }}>
                      {intensityStats.highestIntensity ?? "-"}
                    </div>
                  </div>
                  <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>TREND</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#cbd5e1", marginTop: 2 }}>
                      {intensityStats.trendLabel}
                    </div>
                  </div>
                </div>
                {normalizeBehaviorOccurrences(b).length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 6 }}>
                      INTENSITY RECORDS
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {normalizeBehaviorOccurrences(b).map((record, idx) => (
                        <div
                          key={`${b.id}-${record.timestamp}-${idx}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                            background: "#111827",
                            border: "1px solid #334155",
                            borderRadius: 10,
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 800 }}>
                            #{idx + 1}
                          </div>
                          <select
                            value={record.intensity ?? ""}
                            onChange={(e) =>
                              updateOccurrenceIntensity(
                                b.id,
                                record.timestamp,
                                e.target.value ? parseInt(e.target.value, 10) : null
                              )
                            }
                            style={{
                              background: "#0f172a",
                              border: "1px solid #334155",
                              borderRadius: 8,
                              color: "#e2e8f0",
                              padding: "6px 8px",
                              fontSize: 12,
                              fontFamily: "inherit",
                            }}
                          >
                            <option value="">No intensity</option>
                            {INTENSITY_LEVELS.map((level) => (
                              <option key={level.value} value={level.value}>
                                {level.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeOccurrence(b.id, record.timestamp)}
                            style={{
                              background: "transparent",
                              border: "1px solid #334155",
                              borderRadius: 8,
                              color: "#94a3b8",
                              cursor: "pointer",
                              padding: "6px 8px",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {pendingIntensity && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 120,
          }}
        >
          <div
            style={{
              width: "min(100%, 420px)",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 20px 60px rgba(15, 23, 42, 0.55)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em" }}>
              INTENSITY RATING
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#f1f5f9", marginTop: 6 }}>
              {pendingIntensity.behaviorLabel}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              Rate this {pendingIntensity.occurrenceType === "frequency" ? "occurrence" : "duration segment"}.
              {pendingIntensity.durationSec != null ? ` Duration: ${fmtDuration(pendingIntensity.durationSec)}` : ""}
            </div>
            <div style={{ marginTop: 16 }}>
              <IntensityPicker value={null} onChange={onChooseIntensity} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button
                onClick={onSkipIntensity}
                style={{
                  background: "transparent",
                  border: "1px solid #334155",
                  color: "#cbd5e1",
                  borderRadius: 10,
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Skip
              </button>
              <div style={{ fontSize: 12, color: "#64748b", alignSelf: "center" }}>
                Optional for challenging behaviors.
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddBehavior && (
        <div
          style={{
            background: "#0f172a",
            borderRadius: 12,
            padding: 16,
            border: "1px solid #334155",
            marginTop: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 12 }}>BEHAVIOR LIBRARY</div>
          {availableLib.length === 0 && <div style={{ color: "#475569", fontSize: 13, marginBottom: 16 }}>All library behaviors added.</div>}
          {["positive", "challenging"].map((cat) => {
            const catBehaviors = availableLib.filter((b) => b.category === cat);
            if (catBehaviors.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: cat === "positive" ? "#4ade80" : "#f87171",
                    letterSpacing: "0.06em",
                  }}
                >
                  {cat === "positive" ? "POSITIVE BEHAVIORS" : "CHALLENGING BEHAVIORS"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {catBehaviors.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => onAddBehaviorFromLibrary(b)}
                      style={{
                        background: cat === "positive" ? "#4ade8011" : "#f8717111",
                        border: `1px solid ${cat === "positive" ? "#4ade8044" : "#f8717144"}`,
                        borderRadius: 8,
                        color: "#cbd5e1",
                        padding: "5px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
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
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${customBehavior.behaviorType === "positive" ? "#4ade8055" : "#334155"}`,
                  background: customBehavior.behaviorType === "positive" ? "#4ade8011" : "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
              >
                <input
                  type="radio"
                  name="customBehaviorType"
                  checked={customBehavior.behaviorType === "positive"}
                  onChange={() => setCustomBehavior((p) => ({ ...p, behaviorType: "positive" }))}
                />
                Positive
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${customBehavior.behaviorType === "challenging" ? "#f8717155" : "#334155"}`,
                  background: customBehavior.behaviorType === "challenging" ? "#f8717111" : "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
              >
                <input
                  type="radio"
                  name="customBehaviorType"
                  checked={customBehavior.behaviorType === "challenging"}
                  onChange={() => setCustomBehavior((p) => ({ ...p, behaviorType: "challenging" }))}
                />
                Challenging
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={customBehavior.label}
                onChange={(e) => setCustomBehavior((p) => ({ ...p, label: e.target.value }))}
                placeholder="Behavior name..."
                style={{
                  flex: 1,
                  minWidth: 160,
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
              <select
                value={customBehavior.type}
                onChange={(e) => setCustomBehavior((p) => ({ ...p, type: e.target.value }))}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                <option value="frequency">Frequency</option>
                <option value="duration">Duration</option>
              </select>
              <button
                onClick={onAddCustomBehavior}
                style={{
                  background: (!customBehavior.label.trim() || !customBehavior.behaviorType) ? "#1e293b" : "#38bdf8",
                  color: (!customBehavior.label.trim() || !customBehavior.behaviorType) ? "#475569" : "#0f172a",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                }}
                disabled={!customBehavior.label.trim() || !customBehavior.behaviorType}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeBehaviorList(behaviors: Behavior[] | undefined | null) {
  return (behaviors || []).map((behavior) => ({
    ...behavior,
    occurrences: normalizeBehaviorOccurrences(behavior),
  }));
}

function resetBehaviorForNewVisit(behavior: Behavior): Behavior {
  return {
    ...behavior,
    count: 0,
    intensity: null,
    occurrences: [],
    durationSec: undefined,
  };
}

function appendBehaviorOccurrence(behavior: Behavior, record: BehaviorOccurrence): Behavior {
  const occurrences = normalizeBehaviorOccurrences(behavior);
  return {
    ...behavior,
    occurrences: [...occurrences, record],
    intensity: record.intensity ?? behavior.intensity ?? null,
  };
}

function setBehaviorOccurrenceIntensity(behavior: Behavior, timestamp: number, intensity: number | null): Behavior {
  const records = normalizeBehaviorOccurrences(behavior);
  return {
    ...behavior,
    occurrences: records.map((record) => (record.timestamp === timestamp ? { ...record, intensity } : record)),
    intensity,
  };
}

// --- Active Visit Screen ---
function FirstVisitSelector({
  value,
  onChange,
}: {
  value?: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>
        IS THIS THE FIRST VISIT?
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <label style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", borderRadius: 10,
          border: `2px solid ${value === true ? "#38bdf8" : "#334155"}`,
          background: value === true ? "#38bdf822" : "#1e293b",
          color: value === true ? "#38bdf8" : "#e2e8f0",
          cursor: "pointer", userSelect: "none",
        }}>
          <input type="radio" name="isFirstVisit" checked={value === true} onChange={() => onChange(true)} />
          Yes
        </label>
        <label style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", borderRadius: 10,
          border: `2px solid ${value === false ? "#38bdf8" : "#334155"}`,
          background: value === false ? "#38bdf822" : "#1e293b",
          color: value === false ? "#38bdf8" : "#e2e8f0",
          cursor: "pointer", userSelect: "none",
        }}>
          <input type="radio" name="isFirstVisit" checked={value === false} onChange={() => onChange(false)} />
          No
        </label>
      </div>
    </div>
  );
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
    return base.slice(0, 50);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(0);
  }, [open, query]);

  const commitSelection = (next: string) => {
    onChange(next);
    setQuery(next);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange("");
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIndex(i => Math.min(filtered.length - 1, i + 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIndex(i => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const picked = filtered[highlightIndex];
            if (picked) commitSelection(picked);
            return;
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            const normalized = query.trim().toLowerCase();
            const match = options.find(o => o.trim().toLowerCase() === normalized);
            if (!match) {
              onChange("");
              setQuery("");
            } else {
              onChange(match);
              setQuery(match);
            }
          }, 120);
        }}
        placeholder={placeholder}
        style={{
          width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
          color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
          fontFamily: "inherit"
        }}
      />
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          right: 0,
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 12,
          boxShadow: "0 10px 30px #00000055",
          maxHeight: 260,
          overflowY: "auto",
          zIndex: 60,
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "#64748b" }}>
              No matches
            </div>
          ) : (
            filtered.map((opt, idx) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitSelection(opt)}
                onMouseEnter={() => setHighlightIndex(idx)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  background: idx === highlightIndex ? "#1e293b" : "transparent",
                  border: "none",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ActiveVisit({
  visit,
  onComplete,
  prevVisit,
  isEditing = false,
}: {
  visit: Visit;
  onComplete: (completed: Visit) => void;
  prevVisit?: Visit | null;
  isEditing?: boolean;
}) {
  const totalStudents = visit.totalStudents || null;
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor(visit.totalDuration || 0)));
  const [behaviors, setBehaviors] = useState<Behavior[]>(() => normalizeBehaviorList(visit.behaviors));
  const [durationTimers, setDurationTimers] = useState<Record<string, number>>(() =>
    Object.fromEntries((visit.behaviors || []).filter((b) => b.type === "duration").map((b) => [b.id, b.durationSec || 0]))
  );
  const [notes, setNotes] = useState(visit.notes || "");
  const [recommendations, setRecommendations] = useState(visit.recommendations || "");
  const [implStatus, setImplStatus] = useState(visit.implementationStatus || "");
  const [implNotes, setImplNotes] = useState(visit.implementationNotes || "");
  const [showAddBehavior, setShowAddBehavior] = useState(false);
  const [pendingIntensity, setPendingIntensity] = useState<PendingIntensityPrompt | null>(null);
  const [customBehavior, setCustomBehavior] = useState<{ label: string; type: string; behaviorType?: BehaviorType }>({
    label: "",
    type: "frequency",
    behaviorType: undefined,
  });
  const startRef = useRef<number>(visit.startTime);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTimers = useRef<Record<string, boolean>>({});
  const durationStarts = useRef<Record<string, number>>({});

  useEffect(() => {
    if (isEditing) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current as any);
  }, [isEditing]);

  useBehaviorDurationTimer(activeTimers, setDurationTimers);

  const toggleDuration = (bid: string) => {
    const behavior = behaviors.find((b) => b.id === bid);
    const isRunning = !!activeTimers.current[bid];

    if (!isRunning) {
      durationStarts.current[bid] = Date.now();
      activeTimers.current[bid] = true;
      setDurationTimers((prev) => ({ ...prev }));
      return;
    }

    const startedAt = durationStarts.current[bid] ?? Date.now();
    const durationSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const timestamp = Date.now();
    activeTimers.current[bid] = false;
    delete durationStarts.current[bid];
    setBehaviors((prev) =>
      prev.map((b) =>
        b.id === bid
          ? appendBehaviorOccurrence(b, {
              intensity: null,
              timestamp,
            })
          : b
      )
    );
    setPendingIntensity(
      behavior?.category === "challenging"
        ? {
            behaviorId: bid,
            behaviorLabel: behavior.label,
            occurrenceType: "duration",
            timestamp,
            durationSec,
          }
        : null
    );
    setDurationTimers(prev => ({ ...prev })); // force re-render
  };

  const recordFrequency = (bid: string) => {
    const behavior = behaviors.find((b) => b.id === bid);
    const timestamp = Date.now();
    setBehaviors((prev) =>
      prev.map((b) =>
        b.id === bid
          ? appendBehaviorOccurrence(
              { ...b, count: (b.count || 0) + 1 },
              {
                intensity: null,
                timestamp,
              }
            )
          : b
      )
    );
    setPendingIntensity(
      behavior?.category === "challenging"
        ? {
            behaviorId: bid,
            behaviorLabel: behavior.label,
            occurrenceType: "frequency",
            timestamp,
          }
        : null
    );
  };

  const addBehaviorFromLibrary = (bDef: Behavior) => {
    if (!behaviors.find(b => b.id === bDef.id)) {
      setBehaviors(prev => [...prev, { ...bDef, count: 0, intensity: null, occurrences: [] }]);
    }
    setShowAddBehavior(false);
  };

  const addCustomBehavior = () => {
    if (!customBehavior.label.trim()) return;
    if (!customBehavior.behaviorType) return;
    const nb = {
      id: crypto.randomUUID(),
      label: customBehavior.label,
      type: customBehavior.type,
      category: customBehavior.behaviorType,
      count: 0,
      intensity: null,
      occurrences: [],
      custom: true
    };
    setBehaviors(prev => [...prev, nb]);
    setCustomBehavior({ label: "", type: "frequency", behaviorType: undefined });
    setShowAddBehavior(false);
  };

  const removeBehavior = (bid: string) => {
    setBehaviors(prev => prev.filter(b => b.id !== bid));
    delete activeTimers.current[bid];
    delete durationStarts.current[bid];
    if (pendingIntensity?.behaviorId === bid) setPendingIntensity(null);
  };

  const chooseIntensity = (val: number) => {
    if (!pendingIntensity) return;
    setBehaviors((prev) =>
      prev.map((behavior) =>
        behavior.id === pendingIntensity.behaviorId
          ? setBehaviorOccurrenceIntensity(behavior, pendingIntensity.timestamp, val)
          : behavior
      )
    );
    setPendingIntensity(null);
  };

  const skipIntensity = () => {
    setPendingIntensity(null);
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
      endTime: isEditing ? visit.endTime ?? Date.now() : Date.now(),
      updatedAt: isEditing ? new Date().toISOString() : visit.updatedAt,
      totalDuration: elapsed
    });
  };

  const libBehaviors = (BEHAVIOR_LIBRARY as Record<string, Behavior[]>)[visit.type] || [];
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
              {isEditing ? "EDIT OBSERVATION" : "ACTIVE OBSERVATION"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{visit.subjectName}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
              {visit.type === "student" ? "Student" : visit.type === "classroom" ? "Classroom" : "FBA"} | {visit.observerName}
            </div>
            {visit.schoolName && (
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>School: {visit.schoolName}</div>
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
      {(prevVisit?.recommendations || isEditing || visit.implementationStatus) && (
        <div style={{
          background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16,
          border: "1px solid #f59e0b55"
        }}>
          <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginBottom: 8 }}>
            {prevVisit?.recommendations
              ? `FOLLOW-UP: Recommendations from ${dateStr(prevVisit.endTime || prevVisit.startTime)}`
              : "IMPLEMENTATION FOLLOW-UP"}
          </div>
          {prevVisit?.recommendations && (
            <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 12, fontStyle: "italic" }}>
              &quot;{prevVisit.recommendations}&quot;
            </div>
          )}
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

      <BehaviorSetupSection
        behaviors={behaviors}
        availableLib={availableLib}
        showAddBehavior={showAddBehavior}
        onToggleAddBehavior={() => setShowAddBehavior(!showAddBehavior)}
        customBehavior={customBehavior}
        setCustomBehavior={setCustomBehavior}
        setBehaviors={setBehaviors}
        onAddBehaviorFromLibrary={addBehaviorFromLibrary}
        onAddCustomBehavior={addCustomBehavior}
        onRemoveBehavior={removeBehavior}
        onRecordFrequency={recordFrequency}
        onToggleDuration={toggleDuration}
        pendingIntensity={pendingIntensity}
        onChooseIntensity={chooseIntensity}
        onSkipIntensity={skipIntensity}
        durationTimers={durationTimers}
        setDurationTimers={setDurationTimers}
        activeTimers={activeTimers}
        elapsed={elapsed}
        totalStudents={totalStudents}
      />

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
      }}>{isEditing ? "Save Changes" : `Complete Visit (${fmtTime(elapsed)})`}</button>
    </div>
  );
}

function ActiveFbaVisit({
  visit,
  onComplete,
  isEditing = false,
}: {
  visit: Visit;
  onComplete: (completed: Visit) => void;
  isEditing?: boolean;
}) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor(visit.totalDuration || 0)));
  const startRef = useRef<number>(visit.startTime);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [behaviors, setBehaviors] = useState<Behavior[]>(() => normalizeBehaviorList(visit.behaviors));
  const [durationTimers, setDurationTimers] = useState<Record<string, number>>(() =>
    Object.fromEntries((visit.behaviors || []).filter((b) => b.type === "duration").map((b) => [b.id, b.durationSec || 0]))
  );
  const activeTimers = useRef<Record<string, boolean>>({});
  const durationStarts = useRef<Record<string, number>>({});

  const [showAddBehavior, setShowAddBehavior] = useState(false);
  const [pendingIntensity, setPendingIntensity] = useState<PendingIntensityPrompt | null>(null);
  const [customBehavior, setCustomBehavior] = useState<{ label: string; type: string; behaviorType?: BehaviorType }>({
    label: "",
    type: "frequency",
    behaviorType: undefined,
  });
  const [selectedLatencyBehaviorId, setSelectedLatencyBehaviorId] = useState<string>("");
  const [latencyOtherBehaviorLabel, setLatencyOtherBehaviorLabel] = useState<string>("");
  const firstIntervalSession = visit.fbaIntervalSessions?.[0] ?? null;
  const [selectedIntervalBehaviorId, setSelectedIntervalBehaviorId] = useState<string>(() =>
    firstIntervalSession ? firstIntervalSession.behaviorId ?? "__other__" : ""
  );
  const [intervalOtherBehaviorLabel, setIntervalOtherBehaviorLabel] = useState<string>(() =>
    firstIntervalSession && !firstIntervalSession.behaviorId ? firstIntervalSession.behaviorLabel : ""
  );

  const [abcEntries, setAbcEntries] = useState<AbcEntry[]>(
    visit.abcEntries && visit.abcEntries.length > 0
      ? visit.abcEntries
      : [
        { antecedent: "", behavior: "", consequence: "" },
        { antecedent: "", behavior: "", consequence: "" },
        { antecedent: "", behavior: "", consequence: "" },
      ]
  );

  const [latencyRecords, setLatencyRecords] = useState<number[]>(visit.latencyRecords || []);
  const [fbaLatencyEvents, setFbaLatencyEvents] = useState<FbaLatencyEvent[]>(visit.fbaLatencyEvents || []);
  const [latencyStartMs, setLatencyStartMs] = useState<number | null>(null);
  const [latencyStartMeta, setLatencyStartMeta] = useState<{ startTime: number; behaviorId: string | null; behaviorLabel: string } | null>(null);

  const [intervalLengthSec, setIntervalLengthSec] = useState<number>(
    firstIntervalSession?.intervalLengthSec || visit.intervalLengthSec || 10
  );
  const [intervalRecords, setIntervalRecords] = useState<boolean[]>(
    firstIntervalSession?.records?.length
      ? firstIntervalSession.records.map((record) => record.behaviorPresent)
      : visit.intervalRecords || []
  );
  const [fbaIntervalSessions] = useState<FbaIntervalSession[]>(visit.fbaIntervalSessions || []);
  const [intervalRecordEvents, setIntervalRecordEvents] = useState<FbaIntervalRecord[]>(() => firstIntervalSession?.records || []);
  const [intervalRunning, setIntervalRunning] = useState(false);
  const [intervalCountdown, setIntervalCountdown] = useState(intervalLengthSec);
  const intervalTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [notes, setNotes] = useState(visit.notes || "");
  const [recommendations, setRecommendations] = useState(visit.recommendations || "");

  useEffect(() => {
    if (isEditing) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current as any);
  }, [isEditing]);

  useEffect(() => {
    if (!intervalRunning) return;
    intervalTickRef.current = setInterval(() => {
      setIntervalCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(intervalTickRef.current as any);
  }, [intervalRunning]);

  useEffect(() => {
    if (!intervalRunning) return;
    if (intervalCountdown !== 0) return;
    // Stop ticking at 0 until user records Yes/No.
    setIntervalRunning(false);
  }, [intervalCountdown, intervalRunning]);

  useBehaviorDurationTimer(activeTimers, setDurationTimers);

  const addAbcEntry = () => {
    setAbcEntries((prev) => {
      if (prev.length >= 6) return prev;
      return [...prev, { antecedent: "", behavior: "", consequence: "" }];
    });
  };

  const updateAbcEntry = (idx: number, patch: Partial<AbcEntry>) => {
    setAbcEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const removeAbcEntry = (idx: number) => {
    setAbcEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const studentLib = [...BEHAVIOR_LIBRARY.student, ...BEHAVIOR_LIBRARY.classroom] as Behavior[];
  const availableLib = studentLib.filter((b) => !behaviors.find((bb) => bb.id === b.id));

  const addBehaviorFromLibrary = (bDef: Behavior) => {
    if (!behaviors.find((b) => b.id === bDef.id)) {
      setBehaviors((prev) => [...prev, { ...bDef, count: 0, intensity: null, occurrences: [] }]);
    }
    setShowAddBehavior(false);
  };

  const addCustomBehavior = () => {
    if (!customBehavior.label.trim()) return;
    if (!customBehavior.behaviorType) return;
    const nb: Behavior = {
      id: uid(),
      label: customBehavior.label,
      type: customBehavior.type,
      category: customBehavior.behaviorType,
      count: 0,
      intensity: null,
      occurrences: [],
      custom: true,
    };
    setBehaviors((prev) => [...prev, nb]);
    setCustomBehavior({ label: "", type: "frequency", behaviorType: undefined });
    setShowAddBehavior(false);
  };

  const removeBehavior = (bid: string) => {
    setBehaviors((prev) => prev.filter((b) => b.id !== bid));
    delete activeTimers.current[bid];
    delete durationStarts.current[bid];
    setDurationTimers((prev) => {
      const next = { ...prev };
      delete next[bid];
      return next;
    });
    if (selectedLatencyBehaviorId === bid) setSelectedLatencyBehaviorId("");
    if (selectedIntervalBehaviorId === bid) setSelectedIntervalBehaviorId("");
    if (pendingIntensity?.behaviorId === bid) setPendingIntensity(null);
  };

  const recordFrequency = (bid: string) => {
    const behavior = behaviors.find((b) => b.id === bid);
    const timestamp = Date.now();
    setBehaviors((prev) =>
      prev.map((b) =>
        b.id === bid
          ? appendBehaviorOccurrence(
              { ...b, count: (b.count || 0) + 1 },
              {
                intensity: null,
                timestamp,
              }
            )
          : b
      )
    );
    setPendingIntensity(
      behavior?.category === "challenging"
        ? {
            behaviorId: bid,
            behaviorLabel: behavior.label,
            occurrenceType: "frequency",
            timestamp,
          }
        : null
    );
  };

  const toggleDuration = (bid: string) => {
    const behavior = behaviors.find((b) => b.id === bid);
    const isRunning = !!activeTimers.current[bid];

    if (!isRunning) {
      durationStarts.current[bid] = Date.now();
      activeTimers.current[bid] = true;
      setDurationTimers((prev) => ({ ...prev }));
      return;
    }

    const startedAt = durationStarts.current[bid] ?? Date.now();
    const durationSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const timestamp = Date.now();
    activeTimers.current[bid] = false;
    delete durationStarts.current[bid];
    setBehaviors((prev) =>
      prev.map((b) =>
        b.id === bid
          ? appendBehaviorOccurrence(b, {
              intensity: null,
              timestamp,
            })
          : b
      )
    );
    setPendingIntensity(
      behavior?.category === "challenging"
        ? {
            behaviorId: bid,
            behaviorLabel: behavior.label,
            occurrenceType: "duration",
            timestamp,
            durationSec,
          }
        : null
    );
    setDurationTimers((prev) => ({ ...prev })); // force re-render
  };

  const chooseIntensity = (val: number) => {
    if (!pendingIntensity) return;
    setBehaviors((prev) =>
      prev.map((behavior) =>
        behavior.id === pendingIntensity.behaviorId
          ? setBehaviorOccurrenceIntensity(behavior, pendingIntensity.timestamp, val)
          : behavior
      )
    );
    setPendingIntensity(null);
  };

  const skipIntensity = () => {
    setPendingIntensity(null);
  };

  const startLatency = () => {
    if (!selectedLatencyBehaviorId) return;
    if (selectedLatencyBehaviorId === "__other__" && !latencyOtherBehaviorLabel.trim()) return;
    if (latencyStartMs != null) return;
    const now = Date.now();
    const behaviorId = selectedLatencyBehaviorId === "__other__" ? null : selectedLatencyBehaviorId;
    const behaviorLabel =
      selectedLatencyBehaviorId === "__other__"
        ? latencyOtherBehaviorLabel.trim()
        : behaviors.find((x) => x.id === selectedLatencyBehaviorId)?.label || "Unknown";
    setLatencyStartMs(now);
    setLatencyStartMeta({ startTime: now, behaviorId, behaviorLabel });
  };

  const stopLatency = () => {
    if (latencyStartMs == null) return;
    const stop = Date.now();
    const sec = Math.max(0, Math.round((stop - latencyStartMs) / 1000));
    setLatencyRecords((prev) => [...prev, sec]);
    setFbaLatencyEvents((prev) => [
      ...prev,
      {
        behaviorId: latencyStartMeta?.behaviorId ?? null,
        behaviorLabel: latencyStartMeta?.behaviorLabel ?? "Unknown",
        startTime: latencyStartMeta?.startTime ?? latencyStartMs,
        stopTime: stop,
        latencySec: sec,
        timestamp: Date.now(),
      },
    ]);
    setLatencyStartMs(null);
    setLatencyStartMeta(null);
  };

  const startIntervals = () => {
    if (!selectedIntervalBehaviorId) return;
    if (selectedIntervalBehaviorId === "__other__" && !intervalOtherBehaviorLabel.trim()) return;
    const len = Math.max(1, Math.floor(intervalLengthSec || 10));
    setIntervalLengthSec(len);
    setIntervalCountdown(len);
    setIntervalRunning(true);
  };

  const recordInterval = (val: boolean) => {
    if (!selectedIntervalBehaviorId) return;
    if (selectedIntervalBehaviorId === "__other__" && !intervalOtherBehaviorLabel.trim()) return;
    const len = Math.max(1, Math.floor(intervalLengthSec || 10));
    const nextNumber = intervalRecordEvents.length + 1;
    const evt: FbaIntervalRecord = { intervalNumber: nextNumber, behaviorPresent: val, timestamp: Date.now() };
    setIntervalRecordEvents((prev) => [...prev, evt]);
    setIntervalRecords((prev) => [...prev, val]); // legacy/compat
    setIntervalCountdown(len);
    setIntervalRunning(true);
  };

  const handleComplete = () => {
    const finalBehaviors = behaviors.map((b) => ({
      ...b,
      durationSec: b.type === "duration" ? (durationTimers[b.id] || 0) : undefined,
    }));

    const intervalSessionsNext = (() => {
      if (!selectedIntervalBehaviorId || intervalRecords.length === 0) return fbaIntervalSessions;
      const behaviorId = selectedIntervalBehaviorId === "__other__" ? null : selectedIntervalBehaviorId;
      const behaviorLabel =
        selectedIntervalBehaviorId === "__other__"
          ? intervalOtherBehaviorLabel.trim()
          : behaviors.find((x) => x.id === selectedIntervalBehaviorId)?.label || "Unknown";
      const currentSession = {
        behaviorId,
        behaviorLabel,
        intervalLengthSec: Math.max(1, Math.floor(intervalLengthSec || 10)),
        records: intervalRecordEvents.length > 0
          ? intervalRecordEvents
          : intervalRecords.map((v, i) => ({ intervalNumber: i + 1, behaviorPresent: v, timestamp: Date.now() })),
        startedAt: firstIntervalSession?.startedAt ?? visit.startTime,
      };
      return isEditing && firstIntervalSession ? [currentSession, ...fbaIntervalSessions.slice(1)] : [...fbaIntervalSessions, currentSession];
    })();

    onComplete({
      ...visit,
      behaviors: finalBehaviors,
      abcEntries,
      latencyRecords,
      fbaLatencyEvents,
      intervalLengthSec,
      intervalRecords,
      fbaIntervalSessions: intervalSessionsNext,
      notes,
      recommendations,
      endTime: isEditing ? visit.endTime ?? Date.now() : Date.now(),
      updatedAt: isEditing ? new Date().toISOString() : visit.updatedAt,
      totalDuration: elapsed,
    });
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 80px" }}>
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderRadius: 16, padding: "20px 24px", marginBottom: 20,
        border: "1px solid #334155",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, letterSpacing: "0.08em" }}>
              {isEditing ? "EDIT FBA OBSERVATION" : "FBA OBSERVATION"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#f1f5f9", marginTop: 6 }}>
              {visit.subjectName}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {visit.district ? `District: ${visit.district}` : ""}
              {visit.schoolName ? ` | School: ${visit.schoolName}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>ELAPSED</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>
              {fmtTime(elapsed)}
            </div>
          </div>
        </div>
      </div>

      {/* Student Info */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 10 }}>
          STUDENT INFO
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>STUDENT</div>
            <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 800, marginTop: 4 }}>{visit.subjectName}</div>
          </div>
          <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>OBSERVER</div>
            <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 800, marginTop: 4 }}>{visit.observerName}</div>
          </div>
          <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>GRADE</div>
            <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 800, marginTop: 4 }}>{visit.grade || "-"}</div>
          </div>
        </div>
      </div>

      <BehaviorSetupSection
        behaviors={behaviors}
        availableLib={availableLib}
        showAddBehavior={showAddBehavior}
        onToggleAddBehavior={() => setShowAddBehavior((v) => !v)}
        customBehavior={customBehavior}
        setCustomBehavior={setCustomBehavior}
        setBehaviors={setBehaviors}
        onAddBehaviorFromLibrary={addBehaviorFromLibrary}
        onAddCustomBehavior={addCustomBehavior}
        onRemoveBehavior={removeBehavior}
        onRecordFrequency={recordFrequency}
        onToggleDuration={toggleDuration}
        pendingIntensity={pendingIntensity}
        onChooseIntensity={chooseIntensity}
        onSkipIntensity={skipIntensity}
        durationTimers={durationTimers}
        setDurationTimers={setDurationTimers}
        activeTimers={activeTimers}
        elapsed={elapsed}
      />

      {/* ABC Recording */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em" }}>
            ABC RECORDING ({abcEntries.length}/6)
          </div>
          <button
            onClick={addAbcEntry}
            disabled={abcEntries.length >= 6}
            style={{
              background: abcEntries.length >= 6 ? "#0f172a" : "#38bdf8",
              color: abcEntries.length >= 6 ? "#475569" : "#0f172a",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 900,
              cursor: abcEntries.length >= 6 ? "not-allowed" : "pointer",
            }}
          >
            Add Entry
          </button>
        </div>

        {abcEntries.map((e, idx) => (
          <div key={idx} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800 }}>ENTRY {idx + 1}</div>
              {abcEntries.length > 1 && (
                <button
                  onClick={() => removeAbcEntry(idx)}
                  style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}
                >
                  Remove
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>ANTECEDENT</div>
                <input
                  value={e.antecedent}
                  onChange={(ev) => updateAbcEntry(idx, { antecedent: ev.target.value })}
                  placeholder="What happened right before?"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>BEHAVIOR</div>
                <input
                  value={e.behavior}
                  onChange={(ev) => updateAbcEntry(idx, { behavior: ev.target.value })}
                  placeholder="What did the student do?"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>CONSEQUENCE</div>
                <input
                  value={e.consequence}
                  onChange={(ev) => updateAbcEntry(idx, { consequence: ev.target.value })}
                  placeholder="What happened right after?"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Latency */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 12 }}>
          LATENCY TRACKING
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <select
            value={selectedLatencyBehaviorId}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedLatencyBehaviorId(next);
              setLatencyStartMs(null);
              setLatencyStartMeta(null);
              if (next !== "__other__") setLatencyOtherBehaviorLabel("");
            }}
            style={{
              flex: 1,
              minWidth: 220,
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 10,
              color: "#e2e8f0",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            <option value="">Select behavior...</option>
            {behaviors.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
            <option value="__other__">Other</option>
          </select>
          {selectedLatencyBehaviorId === "__other__" && (
            <input
              value={latencyOtherBehaviorLabel}
              onChange={(e) => setLatencyOtherBehaviorLabel(e.target.value)}
              placeholder="Enter behavior..."
              style={{
                flex: 1,
                minWidth: 180,
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                color: "#e2e8f0",
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={startLatency}
            disabled={
              latencyStartMs != null ||
              !selectedLatencyBehaviorId ||
              (selectedLatencyBehaviorId === "__other__" && !latencyOtherBehaviorLabel.trim())
            }
            style={{
              background:
                latencyStartMs != null ||
                  !selectedLatencyBehaviorId ||
                  (selectedLatencyBehaviorId === "__other__" && !latencyOtherBehaviorLabel.trim())
                  ? "#0f172a"
                  : "#38bdf8",
              color:
                latencyStartMs != null ||
                  !selectedLatencyBehaviorId ||
                  (selectedLatencyBehaviorId === "__other__" && !latencyOtherBehaviorLabel.trim())
                  ? "#475569"
                  : "#0f172a",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 900,
              cursor:
                latencyStartMs != null ||
                  !selectedLatencyBehaviorId ||
                  (selectedLatencyBehaviorId === "__other__" && !latencyOtherBehaviorLabel.trim())
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Start Request
          </button>
          <button
            onClick={stopLatency}
            disabled={latencyStartMs == null}
            style={{
              background: latencyStartMs == null ? "#0f172a" : "linear-gradient(135deg, #34d399, #6ee7b7)",
              color: latencyStartMs == null ? "#475569" : "#0f172a",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 900,
              cursor: latencyStartMs == null ? "not-allowed" : "pointer",
            }}
          >
            Stop (Compliance)
          </button>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
            {latencyStartMs != null ? "Timing..." : "Ready"}
          </div>
        </div>
        {(fbaLatencyEvents.length > 0 || latencyRecords.length > 0) && (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {fbaLatencyEvents.length > 0
                  ? fbaLatencyEvents.map((evt, i) => (
                    <span key={i} style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#0f172a",
                      border: "1px solid #334155",
                      fontSize: 12,
                      color: "#e2e8f0",
                      fontVariantNumeric: "tabular-nums",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      {evt.behaviorLabel}: {evt.latencySec}s
                      <button
                        type="button"
                        onClick={() => {
                          setFbaLatencyEvents((prev) => prev.filter((_, idx) => idx !== i));
                          setLatencyRecords((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#64748b",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 900,
                          padding: 0,
                        }}
                      >
                        x
                      </button>
                    </span>
                  ))
                  : latencyRecords.map((s, i) => (
                <span key={i} style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#0f172a",
                  border: "1px solid #334155",
                  fontSize: 12,
                  color: "#e2e8f0",
                  fontVariantNumeric: "tabular-nums",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  Latency: {s}s
                  <button
                    type="button"
                    onClick={() => setLatencyRecords((prev) => prev.filter((_, idx) => idx !== i))}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 900,
                      padding: 0,
                    }}
                  >
                    x
                  </button>
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Interval Tracking */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 12 }}>
          INTERVAL TRACKING
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <select
            value={selectedIntervalBehaviorId}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedIntervalBehaviorId(next);
              setIntervalRecords([]);
              setIntervalRecordEvents([]);
              setIntervalRunning(false);
              setIntervalCountdown(Math.max(1, Math.floor(intervalLengthSec || 10)));
              if (next !== "__other__") setIntervalOtherBehaviorLabel("");
            }}
            style={{
              flex: 1,
              minWidth: 220,
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 10,
              color: "#e2e8f0",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            <option value="">Select behavior...</option>
            {behaviors.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
            <option value="__other__">Other</option>
          </select>
          {selectedIntervalBehaviorId === "__other__" && (
            <input
              value={intervalOtherBehaviorLabel}
              onChange={(e) => setIntervalOtherBehaviorLabel(e.target.value)}
              placeholder="Enter behavior..."
              style={{
                flex: 1,
                minWidth: 180,
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                color: "#e2e8f0",
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800, marginBottom: 4 }}>INTERVAL (SECONDS)</div>
            <input
              type="number"
              min={1}
              value={intervalLengthSec}
              onChange={(e) => {
                const n = Math.max(1, parseInt(e.target.value || "10", 10));
                setIntervalLengthSec(n);
                if (!intervalRunning) setIntervalCountdown(n);
              }}
              style={{
                width: 140, background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                fontFamily: "inherit"
              }}
            />
          </div>
          <button
            onClick={startIntervals}
            disabled={
              !selectedIntervalBehaviorId ||
              intervalRunning ||
              (selectedIntervalBehaviorId === "__other__" && !intervalOtherBehaviorLabel.trim())
            }
            style={{
              background: !selectedIntervalBehaviorId || intervalRunning ? "#0f172a" : "linear-gradient(135deg, #6366f1, #818cf8)",
              color: !selectedIntervalBehaviorId || intervalRunning ? "#475569" : "white",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 900,
              cursor:
                !selectedIntervalBehaviorId ||
                  intervalRunning ||
                  (selectedIntervalBehaviorId === "__other__" && !intervalOtherBehaviorLabel.trim())
                  ? "not-allowed"
                  : "pointer",
              marginTop: 16
            }}
          >
            Start Interval
          </button>
          <div style={{ marginTop: 16, fontSize: 12, color: "#64748b", fontWeight: 800 }}>
            Countdown: {intervalCountdown}s
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {intervalCountdown === 0 ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 800 }}>Record Behavior Occurring?</div>
              <button onClick={() => recordInterval(true)} style={{
                background: "#4ade80",
                color: "#0f172a",
                border: "none",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer"
              }}>Yes</button>
              <button onClick={() => recordInterval(false)} style={{
                background: "#f87171",
                color: "#0f172a",
                border: "none",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer"
              }}>No</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Recording prompt appears at the end of each interval.
            </div>
          )}
        </div>
        {intervalRecordEvents.length > 0 ? (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {intervalRecordEvents.map((evt) => (
              <span key={evt.intervalNumber} style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: evt.behaviorPresent ? "#4ade8011" : "#f8717111",
                border: `1px solid ${evt.behaviorPresent ? "#4ade8044" : "#f8717144"}`,
                fontSize: 12,
                color: "#e2e8f0",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}>
                #{evt.intervalNumber}: {evt.behaviorPresent ? "Yes" : "No"}
                <button
                  type="button"
                  onClick={() => {
                    setIntervalRecordEvents((prev) =>
                      prev
                        .filter((record) => record.intervalNumber !== evt.intervalNumber)
                        .map((record, idx) => ({ ...record, intervalNumber: idx + 1 }))
                    );
                    setIntervalRecords((prev) => prev.filter((_, idx) => idx !== evt.intervalNumber - 1));
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 900,
                    padding: 0,
                  }}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : intervalRecords.length > 0 ? (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {intervalRecords.map((v, i) => (
              <span key={i} style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: v ? "#4ade8011" : "#f8717111",
                border: `1px solid ${v ? "#4ade8044" : "#f8717144"}`,
                fontSize: 12,
                color: "#e2e8f0",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}>
                {v ? "Yes" : "No"}
                <button
                  type="button"
                  onClick={() => setIntervalRecords((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 900,
                    padding: 0,
                  }}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
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
        width: "100%", background: "linear-gradient(135deg, #38bdf8, #818cf8)",
        color: "#0f172a", border: "none", borderRadius: 14, padding: "16px",
        fontSize: 15, fontWeight: 900, cursor: "pointer"
      }}>
        {isEditing ? "Save Changes" : `Complete FBA (${fmtTime(elapsed)})`}
      </button>
    </div>
  );
}

// --- Visit Summary Card ---
function VisitCard({ visit, onClick, onEdit }: { visit: Visit; onClick: () => void; onEdit: () => void }) {
  const implColor = visit.implementationStatus === "fully" ? "#4ade80"
    : visit.implementationStatus === "partially" ? "#facc15"
    : visit.implementationStatus === "not" ? "#f87171" : null;

  const typeLabel = visit.type === "student" ? "Student" : visit.type === "classroom" ? "Classroom" : "FBA";
  const typeColor = visit.type === "student" ? "#818cf8" : visit.type === "classroom" ? "#f59e0b" : "#34d399";

  return (
    <div onClick={onClick} style={{
      background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 10,
      border: "1px solid #334155", cursor: "pointer", transition: "border-color 0.2s"
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#38bdf8"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#334155"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{visit.subjectName}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {dateStr(visit.startTime)} {timeStr(visit.startTime)} | {fmtDuration(visit.totalDuration || 0)} | {visit.observerName}
          </div>
          {visit.schoolName && <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>School: {visit.schoolName}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge color={typeColor}>
            {typeLabel}
          </Badge>
          {implColor && <Badge color={implColor}>{visit.implementationStatus}</Badge>}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              color: "#38bdf8",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              padding: "5px 10px",
            }}
          >
            Edit
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {(visit.behaviors || []).map(b => {
          const intensityStats = b.category === "challenging" ? getBehaviorIntensityStats(b) : null;
          return (
          <span key={b.id} style={{
            background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
            padding: "3px 8px", fontSize: 11, color: "#94a3b8"
          }}>
            {b.label}: {b.type === "frequency" ? `${b.count || 0}x` : fmtDuration(b.durationSec || 0)}
            {b.category === "challenging" && (
              <span style={{ color: "#64748b" }}>
                {" "}• {intensityStats?.averageIntensity != null
                  ? `avg ${intensityStats.averageIntensity.toFixed(1)}`
                  : "no intensity"}
              </span>
            )}
          </span>
          );
        })}
      </div>
    </div>
  );
}

// --- Visit Detail Modal ---
function VisitDetail({ visit, onClose, onEdit }: { visit: Visit; onClose: () => void; onEdit: () => void }) {
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
              {dateStr(visit.startTime)} | {timeStr(visit.startTime)}-{timeStr(visit.endTime)} | {fmtDuration(visit.totalDuration || 0)}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Observer: {visit.observerName}</div>
            {visit.schoolName && <div style={{ fontSize: 13, color: "#64748b" }}>School: {visit.schoolName}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={onEdit}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#38bdf8",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
                padding: "7px 12px",
              }}
            >
              Edit
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer" }}>x</button>
          </div>
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
            const intensityStats = getBehaviorIntensityStats(b);
            return (
              <div key={b.id} style={{
                background: "#0f172a", borderRadius: 10, padding: 12, marginBottom: 8,
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{b.label}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    <Badge color={b.type === "frequency" ? "#818cf8" : "#34d399"}>{b.type}</Badge>
                    {b.category === "positive" && <Badge color="#4ade80">Positive</Badge>}
                    {b.category === "challenging" && <Badge color="#f87171">Challenging</Badge>}
                  </div>
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
                          : calcRate(b.count || 0, visit.totalDuration || 0))
                      : `${Math.round(((b.durationSec || 0) / (visit.totalDuration || 1)) * 100)}% of visit`}
                  </div>
                </div>
                {b.category === "challenging" && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                    <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>OCCURRENCES</div>
                      <div style={{ fontSize: 16, color: "#f1f5f9", fontWeight: 900, marginTop: 2 }}>{intensityStats.totalOccurrences}</div>
                    </div>
                    <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>AVERAGE</div>
                      <div style={{ fontSize: 16, color: "#f1f5f9", fontWeight: 900, marginTop: 2 }}>
                        {intensityStats.averageIntensity != null ? intensityStats.averageIntensity.toFixed(1) : "-"}
                      </div>
                    </div>
                    <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>HIGHEST</div>
                      <div style={{ fontSize: 16, color: "#f1f5f9", fontWeight: 900, marginTop: 2 }}>
                        {intensityStats.highestIntensity ?? "-"}
                      </div>
                    </div>
                    <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 800 }}>TREND</div>
                      <div style={{ fontSize: 13, color: "#cbd5e1", fontWeight: 700, marginTop: 2 }}>
                        {buildIntensityTrendLabel(intensityStats.trendValues)}
                      </div>
                    </div>
                  </div>
                )}
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

type ReportChartDatum = {
  label: string;
  value: number;
  color?: string;
};

type ReportDateRange = {
  startDate?: string;
  endDate?: string;
};

type ReportMetadata = {
  reportScope: string;
  district: string;
  school: string;
  dateRange: string;
  totalVisits: number;
  generatedOn: string;
};

function normalizeReportOption(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueReportOptions(values: Array<string | null | undefined>) {
  const map = new Map<string, string>();
  for (const value of values) {
    const raw = (value || "").trim();
    if (!raw) continue;
    const key = normalizeReportOption(raw);
    if (!map.has(key)) map.set(key, raw);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function getDistrictOptionsFromVisits(visits: Visit[]) {
  return uniqueReportOptions(visits.map((visit) => visit.district));
}

function getSchoolOptionsForDistrict(visits: Visit[], district: string) {
  if (!district.trim()) return [];
  return uniqueReportOptions(
    visits
      .filter((visit) => visit.district === district)
      .map((visit) => visit.schoolName)
  );
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReportDisplayDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function getReportDateRangeLabel(preset: ReportDatePreset, dateRange: ReportDateRange) {
  if (preset === "last7") return "Last 7 Days";
  if (preset === "last30") return "Last 30 Days";
  if (preset === "last90") return "Last 90 Days";
  if (preset === "schoolYear") return "This School Year";
  const start = formatReportDisplayDate(dateRange.startDate);
  const end = formatReportDisplayDate(dateRange.endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - Present`;
  if (end) return `Through ${end}`;
  return "Custom Range";
}

function formatReportGeneratedOn(date: Date) {
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getReportDateRange(preset: ReportDatePreset, customStartDate: string, customEndDate: string): ReportDateRange {
  if (preset === "custom") {
    return {
      startDate: customStartDate || undefined,
      endDate: customEndDate || undefined,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const end = new Date(today);

  if (preset === "last7") start.setDate(today.getDate() - 6);
  if (preset === "last30") start.setDate(today.getDate() - 29);
  if (preset === "last90") start.setDate(today.getDate() - 89);
  if (preset === "schoolYear") {
    const schoolYearStartMonth = 6; // July, zero-indexed.
    const startYear = today.getMonth() >= schoolYearStartMonth ? today.getFullYear() : today.getFullYear() - 1;
    start.setFullYear(startYear, schoolYearStartMonth, 1);
  }

  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

function getVisitStartMs(visit: Pick<Visit, "startTime">) {
  const raw = visit.startTime;
  if (!raw) return null;
  const numeric = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  const ms = new Date(numeric).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isVisitInReportDateRange(visit: Pick<Visit, "startTime">, dateRange: ReportDateRange) {
  const startMs = dateRange.startDate ? new Date(`${dateRange.startDate}T00:00:00`).getTime() : undefined;
  const endMs = dateRange.endDate ? new Date(`${dateRange.endDate}T23:59:59.999`).getTime() : undefined;
  if (startMs == null && endMs == null) return true;
  const visitMs = getVisitStartMs(visit);
  if (visitMs == null) return false;
  if (startMs != null && visitMs < startMs) return false;
  if (endMs != null && visitMs > endMs) return false;
  return true;
}

function filterOrganizationalReportVisits(
  visits: Visit[],
  scope: ReportScope,
  district: string,
  school: string,
  dateRange: ReportDateRange
) {
  if (!district.trim()) return [];
  return visits.filter((visit) => {
    if (visit.district !== district) return false;
    if (scope === "school" && school && visit.schoolName !== school) return false;
    return isVisitInReportDateRange(visit, dateRange);
  });
}

function ReportMetadataCard({ metadata }: { metadata: ReportMetadata }) {
  const rows = [
    { label: "Report Scope", value: metadata.reportScope },
    { label: "District", value: metadata.district || "Select a district" },
    { label: "School", value: metadata.school },
    { label: "Date Range", value: metadata.dateRange },
    { label: "Total Visits", value: metadata.totalVisits },
    { label: "Generated On", value: metadata.generatedOn },
  ];

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 4, textTransform: "uppercase" }}>{metadata.reportScope} Report</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#f1f5f9" }}>{metadata.district || "No district selected"}</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>{metadata.school} | {metadata.dateRange}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{row.label}</div>
            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, marginTop: 4 }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportBarChart({ title, data }: { title: string; data: ReportChartDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 12, textTransform: "uppercase" }}>{title}</div>
      {data.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 13, padding: "8px 0" }}>No data yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {data.map((d) => (
            <div key={d.label}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
                <div style={{ color: "#e2e8f0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
                <div style={{ color: d.color || "#38bdf8", fontSize: 12, fontWeight: 800 }}>{d.value}</div>
              </div>
              <div style={{ height: 8, background: "#0f172a", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(4, (d.value / max) * 100)}%`, height: "100%", background: d.color || "#38bdf8", borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Reports View ---
function Reports({ visits }: { visits: Visit[] }) {
  const [filter, setFilter] = useState("all");
  const [selectedSubject, setSelectedSubject] = useState("all");
  const [reportScope, setReportScope] = useState<ReportScope>("district");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [datePreset, setDatePreset] = useState<ReportDatePreset>("last30");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // FBA observations are excluded from aggregated reports (school/district/teacher trends).
  const reportableVisits = useMemo(() => visits.filter((v) => v.type !== "fba"), [visits]);

  const districtOptions = useMemo(() => getDistrictOptionsFromVisits(reportableVisits), [reportableVisits]);
  const scopedSchoolOptions = useMemo(
    () => getSchoolOptionsForDistrict(reportableVisits, districtFilter),
    [districtFilter, reportableVisits]
  );
  const isOrganizationalScope = reportScope === "district" || reportScope === "school";
  const reportDateRange = useMemo(
    () => getReportDateRange(datePreset, customStartDate, customEndDate),
    [customEndDate, customStartDate, datePreset]
  );
  const reportDateRangeLabel = useMemo(
    () => getReportDateRangeLabel(datePreset, reportDateRange),
    [datePreset, reportDateRange]
  );
  const selectedReportVisits = useMemo(
    () => filterOrganizationalReportVisits(reportableVisits, reportScope, districtFilter, schoolFilter, reportDateRange),
    [districtFilter, reportDateRange, reportScope, reportableVisits, schoolFilter]
  );
  const reportMetadata = useMemo<ReportMetadata>(() => ({
    reportScope: reportScope === "school" ? "School" : "District",
    district: districtFilter,
    school: reportScope === "school" && schoolFilter ? schoolFilter : "All Schools",
    dateRange: reportDateRangeLabel,
    totalVisits: selectedReportVisits.length,
    generatedOn: formatReportGeneratedOn(new Date()),
  }), [districtFilter, reportDateRangeLabel, reportScope, schoolFilter, selectedReportVisits.length]);

  const organizationalSummaryCards = useMemo(() => {
    if (reportScope !== "district" && reportScope !== "school") return [];

    const teachers = new Set(selectedReportVisits.filter((v) => v.type === "classroom").map((v) => v.subjectName).filter(Boolean));
    const students = new Set(selectedReportVisits.filter((v) => v.type === "student").map((v) => v.subjectName).filter(Boolean));
    const schools = new Set(selectedReportVisits.map((v) => v.schoolName || "").filter(Boolean));
    const averageDuration = selectedReportVisits.length
      ? Math.round(selectedReportVisits.reduce((sum, v) => sum + (v.totalDuration || 0), 0) / selectedReportVisits.length)
      : 0;

    if (reportScope === "district") {
      return [
        { label: "Total Schools", value: schools.size, color: "#38bdf8" },
        { label: "Total Teachers", value: teachers.size, color: "#818cf8" },
        { label: "Total Students", value: students.size, color: "#34d399" },
        { label: "Total Observations", value: selectedReportVisits.length, color: "#f59e0b" },
      ];
    }

    return [
      { label: "Total Teachers", value: teachers.size, color: "#38bdf8" },
      { label: "Total Students", value: students.size, color: "#34d399" },
      { label: "Total Observations", value: selectedReportVisits.length, color: "#f59e0b" },
      { label: "Avg. Duration", value: fmtDuration(averageDuration), color: "#818cf8" },
    ];
  }, [reportScope, selectedReportVisits]);

  const organizationalChartData = useMemo(() => {
    if (reportScope !== "district" && reportScope !== "school") return null;

    const schoolCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>([
      ["Student", 0],
      ["Classroom", 0],
    ]);
    const implementationCounts = new Map<string, number>();
    const behaviorCounts = new Map<string, number>();
    let positive = 0;
    let challenging = 0;

    for (const visit of selectedReportVisits) {
      if (visit.schoolName) schoolCounts.set(visit.schoolName, (schoolCounts.get(visit.schoolName) || 0) + 1);
      typeCounts.set(visit.type === "classroom" ? "Classroom" : "Student", (typeCounts.get(visit.type === "classroom" ? "Classroom" : "Student") || 0) + 1);
      const implementation = visit.implementationStatus
        ? `${visit.implementationStatus.charAt(0).toUpperCase()}${visit.implementationStatus.slice(1)}`
        : "None";
      implementationCounts.set(implementation, (implementationCounts.get(implementation) || 0) + 1);

      for (const behavior of visit.behaviors || []) {
        const amount = behavior.type === "duration" ? (behavior.durationSec || 0) : (behavior.count || 0);
        if (behavior.category === "positive") positive += amount;
        if (behavior.category === "challenging") challenging += amount;
        behaviorCounts.set(behavior.label, (behaviorCounts.get(behavior.label) || 0) + amount);
      }
    }

    const toData = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    return {
      observationsBySchool: toData(schoolCounts),
      behaviorBalance: [
        { label: "Positive", value: positive, color: "#34d399" },
        { label: "Challenging", value: challenging, color: "#f87171" },
      ].filter((d) => d.value > 0),
      observationTypes: toData(typeCounts).map((d) => ({ ...d, color: d.label === "Student" ? "#38bdf8" : "#818cf8" })),
      implementationStatus: toData(implementationCounts).map((d) => ({
        ...d,
        color: d.label === "Fully" ? "#4ade80" : d.label === "Partially" ? "#facc15" : d.label === "Not" ? "#f87171" : "#64748b",
      })),
      frequentBehaviors: toData(behaviorCounts),
    };
  }, [reportScope, selectedReportVisits]);

  const downloadReport = async (format: "xlsx" | "csv" = "xlsx") => {
    setDownloading(true);
    setReportError(null);
    try {
      if ((reportScope === "district" || reportScope === "school") && !districtFilter.trim()) {
        throw new Error("Select a district before downloading this report.");
      }
      const params = new URLSearchParams();
      if ((reportScope === "district" || reportScope === "school") && districtFilter) params.set("district", districtFilter);
      if (reportScope === "school" && schoolFilter) params.set("school", schoolFilter);
      if (reportDateRange.startDate) params.set("startDate", reportDateRange.startDate);
      if (reportDateRange.endDate) params.set("endDate", reportDateRange.endDate);
      params.set("dateRangeLabel", reportDateRangeLabel);
      if (format === "csv") params.set("format", "csv");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sign in again before downloading this report.");

      const res = await fetch(`/api/reports?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);

      const blob = await res.blob();
      const filename = `observations-report.${format === "csv" ? "csv" : "xlsx"}`;
      const nav = window.navigator as Navigator & {
        msSaveOrOpenBlob?: (blob: Blob, defaultName?: string) => boolean;
      };
      if (typeof nav?.msSaveOrOpenBlob === "function") {
        nav.msSaveOrOpenBlob(blob, filename);
      } else {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to download report.");
    } finally {
      setDownloading(false);
    }
  };

  const subjects = [...new Set(reportableVisits.map(v => v.subjectName))].sort();
  const filtered = reportableVisits.filter(v =>
    (filter === "all" || v.type === filter) &&
    (selectedSubject === "all" || v.subjectName === selectedSubject)
  ).sort((a, b) => b.startTime - a.startTime);

  // Aggregate behavior trends
  const behaviorTrends: Record<string, { total: number; visits: number; type: string }> = {};
  filtered.forEach(v => {
    (v.behaviors || []).forEach(b => {
      if (!behaviorTrends[b.label]) behaviorTrends[b.label] = { total: 0, visits: 0, type: b.type };
      behaviorTrends[b.label].visits++;
      if (b.type === "frequency") behaviorTrends[b.label].total += (b.count || 0);
      else behaviorTrends[b.label].total += (b.durationSec || 0);
    });
  });

  // Implementation stats
  const implStats: Record<string, number> = { fully: 0, partially: 0, not: 0, none: 0 };
  filtered.forEach(v => {
    if (v.implementationStatus) implStats[v.implementationStatus]++;
    else implStats.none++;
  });
  const totalWithFollowup = implStats.fully + implStats.partially + implStats.not;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {/* Report export filters */}
      <div style={{
        background: "#1e293b",
        borderRadius: 12,
        padding: 14,
        border: "1px solid #334155",
        marginBottom: 16
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 10 }}>
          REPORT EXPORT
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>REPORT SCOPE</div>
            <select
              value={reportScope}
              onChange={e => {
                setReportScope(e.target.value as ReportScope);
                setSchoolFilter("");
                setDistrictFilter("");
              }}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                fontFamily: "inherit"
              }}
            >
              <option value="district">District</option>
              <option value="school">School</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>DISTRICT</div>
            <select
              value={districtFilter}
              onChange={e => {
                setDistrictFilter(e.target.value);
                setSchoolFilter("");
              }}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                fontFamily: "inherit"
              }}
            >
              <option value="">Select district...</option>
              {districtOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {reportScope === "school" && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>SCHOOL</div>
            <select
              value={schoolFilter}
              onChange={e => setSchoolFilter(e.target.value)}
              disabled={!districtFilter}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                color: districtFilter ? "#e2e8f0" : "#475569", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                fontFamily: "inherit", cursor: districtFilter ? "pointer" : "not-allowed"
              }}
            >
              <option value="">{districtFilter ? "All Schools" : "Select a district first"}</option>
              {scopedSchoolOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {districtFilter && scopedSchoolOptions.length === 0 && (
              <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>No schools found for this district.</div>
            )}
          </div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>DATE RANGE</div>
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as ReportDatePreset)}
              style={{
                width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                fontFamily: "inherit"
              }}
            >
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
              <option value="last90">Last 90 Days</option>
              <option value="schoolYear">This School Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {datePreset === "custom" && (
            <>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>START DATE</div>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  style={{
                    width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>END DATE</div>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  style={{
                    width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "10px 12px", fontSize: 13, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
            </>
          )}
        </div>
        {reportError && (
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #7f1d1d",
            background: "#7f1d1d22",
            color: "#fecaca",
            fontSize: 12
          }}>
            {reportError}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button
            onClick={() => downloadReport("xlsx")}
            disabled={downloading || (isOrganizationalScope && !districtFilter.trim())}
            style={{
              background: (downloading || (isOrganizationalScope && !districtFilter.trim())) ? "#1e293b" : "linear-gradient(135deg, #38bdf8, #818cf8)",
              color: (downloading || (isOrganizationalScope && !districtFilter.trim())) ? "#475569" : "#0f172a",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 900,
              cursor: (downloading || (isOrganizationalScope && !districtFilter.trim())) ? "not-allowed" : "pointer",
            }}
          >
            {downloading ? "Generating..." : "Generate Report"}
          </button>
          {isOrganizationalScope && (
            <button
              onClick={() => downloadReport("csv")}
              disabled={downloading || !districtFilter.trim()}
              style={{
                background: "#0f172a",
                color: (downloading || !districtFilter.trim()) ? "#475569" : "#e2e8f0",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 900,
                cursor: (downloading || !districtFilter.trim()) ? "not-allowed" : "pointer",
              }}
            >
              {downloading ? "Generating..." : "Download CSV"}
            </button>
          )}
        </div>
      </div>

      <ReportMetadataCard metadata={reportMetadata} />

      {organizationalSummaryCards.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
          {organizationalSummaryCards.map(c => (
            <div key={c.label} style={{
              background: "#1e293b", borderRadius: 12, padding: 14, border: "1px solid #334155"
            }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {organizationalChartData && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 20 }}>
          {reportScope === "district" && (
            <ReportBarChart title="Observations by School" data={organizationalChartData.observationsBySchool} />
          )}
          <ReportBarChart title="Positive vs Challenging Behaviors" data={organizationalChartData.behaviorBalance} />
          <ReportBarChart title="Observation Types" data={organizationalChartData.observationTypes} />
          <ReportBarChart title="Implementation Status" data={organizationalChartData.implementationStatus} />
          {reportScope === "school" && (
            <ReportBarChart title="Most Frequent Behaviors" data={organizationalChartData.frequentBehaviors} />
          )}
        </div>
      )}

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

// --- Main App ---
function PageInner() {
  const { user } = useAuth();
  const [data, setData] = useState<DataState | null>(null);
  const [screen, setScreen] = useState<"home" | "new-visit" | "active" | "history" | "reports">("home"); // home | new-visit | active | history | reports
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [newVisitForm, setNewVisitForm] = useState<NewVisitFormState>({
    type: "student",
    subjectName: "",
    observerName: "",
    grade: "",
    totalStudents: "",
    selectedDistrict: "",
    customDistrict: "",
    schoolName: "",
    isFirstVisit: undefined,
  });
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [tab, setTab] = useState<"" | "home" | "history" | "reports">("home");
  const [implementationStatus, setImplementationStatus] = useState("");
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlFirstVisitParam = searchParams.get("firstVisit");
  const isFirstVisitFromUrl =
    urlFirstVisitParam === "true" ? true : urlFirstVisitParam === "false" ? false : undefined;
  const newVisitStep = (searchParams.get("step") === "details" ? "details" : "firstVisit") as "firstVisit" | "details";
  const selectedFirstVisit = isFirstVisitFromUrl ?? newVisitForm.isFirstVisit;

  const handleFirstVisitChange = (val: boolean) => {
    setNewVisitForm((prev) => ({
      ...prev,
      isFirstVisit: val,
      ...(val === false ? { subjectName: "" } : {}),
    }));
    if (val === true) setImplementationStatus("");
    router.push(`/?step=details&firstVisit=${val}`);
  };

  useEffect(() => {
    const logSupabaseError = (label: string, error: any) => {
      if (!error) return;
      console.error(label, {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
        raw: error,
      });
    };

    const fetchPersistedVisits = async () => {
      if (!user?.id) {
        setData({ visits: [], subjects: [] });
        return;
      }

      console.info("[visits] Fetch start: visits table");
      try {
        const { data: visits, error } = await supabase
          .from("visits")
          .select("*")
          .eq("created_by", user.id)
          .order("start_time", { ascending: false });

        if (error) {
          logSupabaseError("[visits] Fetch error", error);
          setData({ visits: [], subjects: [] });
          return;
        }

        const mappedVisits: Visit[] = (visits || []).map((v: any) => {
          const start = v.start_time ?? v.startTime;
          const end = v.end_time ?? v.endTime;

          return {
            ...v,
            type: (v.observation_type ?? v.type ?? "student") as Visit["type"],
            subjectName: v.subject_name ?? v.subjectName,
            observerName: v.observer_name ?? v.observerName,
            isFirstVisit: v.is_first_visit ?? v.isFirstVisit,
            implementationStatus: v.implementation_status ?? v.implementationStatus,
            district: v.district ?? v.districtName,
            schoolName: v.school_name ?? v.schoolName,
            totalStudents: v.total_students ?? v.totalStudents,
            abcEntries: v.abc_entries ?? v.abcEntries,
            latencyRecords: v.latency_records ?? v.latencyRecords,
            fbaLatencyEvents: v.fba_latency_events ?? v.fbaLatencyEvents,
            intervalRecords: v.interval_records ?? v.intervalRecords,
            intervalLengthSec: v.interval_length_sec ?? v.intervalLengthSec,
            fbaIntervalSessions: v.fba_interval_sessions ?? v.fbaIntervalSessions,
            notes: v.notes,
            recommendations: v.recommendations,
            implementationNotes: v.implementation_notes ?? v.implementationNotes,
            updatedAt: v.updated_at ?? v.updatedAt,
            behaviors: normalizeBehaviorList(v.behaviors ?? v.behaviors),
            startTime: (typeof start === "number" ? start : start ? new Date(start).getTime() : null) as any,
            endTime: (typeof end === "number" ? end : end ? new Date(end).getTime() : null) as any,
            totalDuration: v.total_duration ?? v.totalDuration,
          };
        });

        console.info("[visits] Fetch success", {
          count: mappedVisits.length,
          newestStartTime: mappedVisits[0]?.startTime ?? null,
        });
        setData({ visits: mappedVisits, subjects: [] });
      } catch (e) {
        console.error("[visits] Fetch failed (exception)", e);
        setData({ visits: [], subjects: [] });
      }
    };

    fetchPersistedVisits();
  }, [user?.id]);

  const persistData = useCallback((d: DataState) => {
    setData(d);
  }, []);

  const startVisit = () => {
    if (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim()) return;
    if (!newVisitForm.grade) return;
    if (selectedFirstVisit === undefined) return;
    if (newVisitForm.type !== "fba" && selectedFirstVisit === false && !implementationStatus) return;
    if (!newVisitForm.selectedDistrict) return;
    const districtValue =
      newVisitForm.selectedDistrict === "Other" ? newVisitForm.customDistrict.trim() : newVisitForm.selectedDistrict;
    if (newVisitForm.selectedDistrict === "Other" && !districtValue) return;
    if (!newVisitForm.schoolName.trim()) return;

    // Find previous visits for this subject
    const prevVisits = (data?.visits || []).filter(v =>
      v.subjectName.toLowerCase() === newVisitForm.subjectName.toLowerCase() && v.type === newVisitForm.type
    ).sort((a, b) => b.startTime - a.startTime);

    const prevBehaviors =
      newVisitForm.type === "fba"
        ? []
        : prevVisits.length > 0
          ? (() => {
            const allowedBehaviorIds = new Set(BEHAVIOR_LIBRARY[newVisitForm.type].map(b => b.id));
            return (prevVisits[0].behaviors || [])
              .filter(b => allowedBehaviorIds.has(b.id))
              .map((b) => resetBehaviorForNewVisit(b));
          })()
          : [];

    const visit: Visit = {
      id: uid(),
      type: newVisitForm.type,
      subjectName: newVisitForm.subjectName.trim(),
      observerName: newVisitForm.observerName.trim(),
      grade: newVisitForm.grade,
      district: districtValue,
      schoolName: newVisitForm.schoolName.trim(),
      totalStudents: newVisitForm.type === "classroom" ? (parseInt(newVisitForm.totalStudents) || null) : null,
      startTime: Date.now(),
      behaviors: prevBehaviors,
      isFirstVisit: selectedFirstVisit,
      implementationStatus: newVisitForm.type !== "fba" && selectedFirstVisit === false ? implementationStatus : undefined,
      prevVisit: prevVisits[0] || null
    } as any;
    setEditingVisitId(null);
    setActiveVisit(visit);
    setScreen("active");
  };

  const editVisit = (visit: Visit) => {
    setSelectedVisit(null);
    setEditingVisitId(visit.id);
    setActiveVisit({ ...visit, prevVisit: null });
    setScreen("active");
  };

  const completeVisit = (completedVisit: Visit) => {
    const isEditing = editingVisitId === completedVisit.id;
    const completedWithTimestamp: Visit = isEditing
      ? { ...completedVisit, updatedAt: completedVisit.updatedAt ?? new Date().toISOString() }
      : completedVisit;
    const updatedVisits = isEditing
      ? (data?.visits || []).map((visit) => (visit.id === completedWithTimestamp.id ? completedWithTimestamp : visit))
      : [...(data?.visits || []), completedWithTimestamp];
    const updated: DataState = { ...(data as DataState), visits: updatedVisits };

    setData(updated);

    (async () => {
      const logSupabaseError = (label: string, error: any) => {
        if (!error) return;
        console.error(label, {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
          raw: error,
        });
      };

      const visitObjectBase = {
        subject_name: completedVisit.subjectName,
        observer_name: completedVisit.observerName,
        type: completedVisit.type ?? "",
        district: completedVisit.district ?? "",
        school_name: completedVisit.schoolName ?? "",
        grade: completedVisit.grade ?? "",
        total_students: completedVisit.totalStudents ?? 0,
        start_time: completedVisit.startTime ? new Date(completedVisit.startTime).getTime() : null,
        end_time: completedVisit.endTime ? new Date(completedVisit.endTime).getTime() : null,
        total_duration: completedVisit.totalDuration ?? null,
        behaviors: completedVisit.behaviors ?? [],
        notes: completedVisit.notes ?? null,
        recommendations: completedVisit.recommendations ?? null,
        implementation_status: completedVisit.implementationStatus ?? null,
        implementation_notes: completedVisit.implementationNotes ?? null,
      };

      const visitObject = {
        ...visitObjectBase,
        // For forward compatibility with schemas that store the observation type separately.
        ...(completedVisit.type ? { observation_type: completedVisit.type } : {}),
        ...(completedVisit.isFirstVisit !== undefined ? { is_first_visit: completedVisit.isFirstVisit } : {}),
        ...(completedVisit.type === "fba"
          ? {
            abc_entries: completedVisit.abcEntries ?? [],
            latency_records: completedVisit.latencyRecords ?? [],
            fba_latency_events: completedVisit.fbaLatencyEvents ?? [],
            interval_records: completedVisit.intervalRecords ?? [],
            interval_length_sec: completedVisit.intervalLengthSec ?? null,
            fba_interval_sessions: completedVisit.fbaIntervalSessions ?? [],
          }
          : {}),
      };

      console.info(isEditing ? "[visits] Update start" : "[visits] Insert start", {
        type: completedVisit.type,
        subject: completedVisit.subjectName,
        startTime: completedVisit.startTime,
      });

      if (!user?.id) {
        logSupabaseError("[visits] Insert error", new Error("No authenticated user found."));
        return;
      }

      const missingColumnPattern =
        /(is_first_visit|district|implementation_status|implementation_notes|observation_type|notes|recommendations|abc_entries|latency_records|fba_latency_events|interval_records|interval_length_sec|fba_interval_sessions|updated_at)/i;

      if (isEditing) {
        let updateObject: Record<string, unknown> = { ...visitObject, updated_at: completedWithTimestamp.updatedAt };
        let updateResult = await supabase
          .from("visits")
          .update(updateObject)
          .eq("id", completedVisit.id)
          .eq("created_by", user.id)
          .select();

        if (updateResult.error && missingColumnPattern.test(updateResult.error.message || "")) {
          logSupabaseError("[visits] Update retry due to missing column(s)", updateResult.error);
          updateObject = { ...visitObjectBase, updated_at: completedWithTimestamp.updatedAt };
          updateResult = await supabase
            .from("visits")
            .update(updateObject)
            .eq("id", completedVisit.id)
            .eq("created_by", user.id)
            .select();
        }

        if (updateResult.error) {
          logSupabaseError("[visits] Update error", updateResult.error);
        } else {
          console.info("[visits] Update success", { rowsUpdated: updateResult.data?.length ?? 0 });
        }

        console.debug("[visits] Update response data:", updateResult.data);
      } else {
        const insertObject = {
          id: completedVisit.id,
          created_by: user.id,
          ...visitObject,
        };
        const insertObjectBase = {
          id: insertObject.id,
          created_by: user.id,
          ...visitObjectBase,
        };
        let insertResult = await supabase.from("visits").insert([insertObject]).select();
        if (insertResult.error && missingColumnPattern.test(insertResult.error.message || "")) {
          logSupabaseError("[visits] Insert retry due to missing column(s)", insertResult.error);
          insertResult = await supabase.from("visits").insert([insertObjectBase]).select();
        }

        if (insertResult.error) {
          logSupabaseError("[visits] Insert error", insertResult.error);
        } else {
          console.info("[visits] Insert success", { rowsInserted: insertResult.data?.length ?? 0 });
        }

        console.debug("[visits] Insert response data:", insertResult.data);
      }
    })();

    setActiveVisit(null);
    setEditingVisitId(null);
    setScreen("home");
    setTab("home");
    setNewVisitForm({
      type: "student",
      subjectName: "",
      observerName: "",
      grade: "",
      totalStudents: "",
      selectedDistrict: "",
      customDistrict: "",
      schoolName: "",
      isFirstVisit: undefined,
    });
    setImplementationStatus("");
    router.push("/?step=firstVisit");
  };

  const allVisits = (data?.visits || []).sort((a, b) => b.startTime - a.startTime);
  const subjectNameOptions = useMemo(() => {
    const keyFor = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const byKey = new Map<string, string>();
    for (const v of allVisits) {
      const isEligible =
        newVisitForm.type === "fba"
          ? v.type === "student" || v.type === "fba"
          : v.type === newVisitForm.type;
      if (!isEligible) continue;
      const raw = (v.subjectName || "").trim();
      if (!raw) continue;
      const k = keyFor(raw);
      if (!byKey.has(k)) byKey.set(k, raw);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [allVisits, newVisitForm.type]);

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
          <Link href="/" className="flex items-center gap-2" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image
              src="/logo.png"
              alt="InMind Observer Logo"
              width={36}
              height={36}
              className="object-contain"
              priority
              style={{ objectFit: "contain" }}
            />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>InMind Observer</div>
              <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1 }}>Behavior Tracking</div>
            </div>
          </Link>
        </div>
        {screen === "active" && (
          <div style={{ fontSize: 12, color: "#f97316", fontWeight: 700, background: "#f9731622",
            padding: "4px 10px", borderRadius: 20, border: "1px solid #f9731644" }}>
            LIVE
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 16px", maxWidth: 720, margin: "0 auto" }}>

        {/* Active visit */}
        {screen === "active" && activeVisit && (
          activeVisit.type === "fba" ? (
            <ActiveFbaVisit visit={activeVisit} onComplete={completeVisit} isEditing={editingVisitId === activeVisit.id} />
          ) : (
            <ActiveVisit
              visit={activeVisit}
              prevVisit={activeVisit.prevVisit}
              onComplete={completeVisit}
              isEditing={editingVisitId === activeVisit.id}
            />
          )
        )}

        {/* New visit form */}
        {screen === "new-visit" && (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
              <button onClick={() => {
                setImplementationStatus("");
                setNewVisitForm(p => ({ ...p, subjectName: "" }));
                router.push("/?step=firstVisit");
                setScreen("home");
                setTab("home");
              }} style={{
                background: "none", border: "1px solid #334155", color: "#94a3b8",
                borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer"
              }}>&lt;- Back</button>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>New Visit</div>
            </div>

            {newVisitStep === "firstVisit" && (
              <>
                <FirstVisitSelector
                  value={selectedFirstVisit}
                  onChange={handleFirstVisitChange}
                />
              </>
            )}

            {newVisitStep === "details" && (
              <>
                <FirstVisitSelector
                  value={selectedFirstVisit}
                  onChange={handleFirstVisitChange}
                />

                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {(["student", "classroom", "fba"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setImplementationStatus("");
                      setNewVisitForm(p => ({
                      ...p,
                      type: t,
                      ...(selectedFirstVisit === false ? { subjectName: "" } : {})
                    }));
                  }}
                  style={{
                  flex: 1, padding: "12px", borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: `2px solid ${newVisitForm.type === t ? "#38bdf8" : "#334155"}`,
                  background: newVisitForm.type === t ? "#38bdf822" : "#1e293b",
                  color: newVisitForm.type === t ? "#38bdf8" : "#64748b", cursor: "pointer",
                  textTransform: "capitalize"
                }}
                >
                  {t === "student" ? "Student" : t === "classroom" ? "Classroom" : "FBA"}
                </button>
              ))}
                </div>

            {([
              {
                key: "subjectName" as const,
                label: newVisitForm.type === "classroom" ? "Classroom / Teacher" : "Student Name",
                placeholder: newVisitForm.type === "classroom" ? "e.g. Ms. Johnson - Room 12" : "e.g. Alex M.",
              },
              { key: "observerName" as const, label: "Observer Name", placeholder: "Your name" },
            ] as const).map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>{f.label.toUpperCase()}</div>
                {f.key === "subjectName" && selectedFirstVisit === false && subjectNameOptions.length > 0 ? (
                  <SearchableSelect
                    options={subjectNameOptions}
                    value={newVisitForm.subjectName}
                    onChange={(next) => setNewVisitForm(p => ({ ...p, subjectName: next }))}
                    placeholder="Search and select..."
                  />
                ) : (
                  <input
                    value={newVisitForm[f.key]}
                    onChange={e => setNewVisitForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{
                      width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                      color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                      fontFamily: "inherit"
                    }}
                  />
                )}
                {f.key === "subjectName" && selectedFirstVisit === false && subjectNameOptions.length === 0 && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                    No previous names found yet - free entry is enabled for now.
                  </div>
                )}
              </div>
            ))}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>GRADE</div>
              <select
                required
                value={newVisitForm.grade}
                onChange={e => setNewVisitForm(p => ({ ...p, grade: e.target.value }))}
                style={{
                  width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                  color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                  fontFamily: "inherit"
                }}
              >
                <option value="" disabled>
                  Select Grade
                </option>
                {GRADE_OPTIONS.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>DISTRICT</div>
              <select
                required
                value={newVisitForm.selectedDistrict}
                onChange={(e) => {
                  const next = e.target.value;
                  setNewVisitForm(p => ({
                    ...p,
                    selectedDistrict: next,
                    schoolName: "",
                    ...(next === "Other" ? {} : { customDistrict: "" }),
                  }));
                }}
                style={{
                  width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                  color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                  fontFamily: "inherit"
                }}
              >
                <option value="" disabled>Select...</option>
                {DISTRICT_OPTIONS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {newVisitForm.selectedDistrict === "Other" && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>DISTRICT NAME</div>
                <input
                  required
                  value={newVisitForm.customDistrict}
                  onChange={e => setNewVisitForm(p => ({ ...p, customDistrict: e.target.value }))}
                  placeholder="e.g. Boston Public Schools"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
                SCHOOL NAME
              </div>
              {newVisitForm.selectedDistrict && newVisitForm.selectedDistrict !== "Other" ? (
                <select
                  required
                  value={newVisitForm.schoolName}
                  onChange={e => setNewVisitForm(p => ({ ...p, schoolName: e.target.value }))}
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                >
                  <option value="" disabled>Select...</option>
                  {(districtSchoolMap[newVisitForm.selectedDistrict] || []).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  required={newVisitForm.selectedDistrict === "Other"}
                  value={newVisitForm.schoolName}
                  onChange={e => setNewVisitForm(p => ({ ...p, schoolName: e.target.value }))}
                  placeholder="e.g. Lincoln Elementary"
                  style={{
                    width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                    color: "#e2e8f0", padding: "12px 14px", fontSize: 14, boxSizing: "border-box",
                    fontFamily: "inherit"
                  }}
                />
              )}
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
                  Used to calculate % of students for On-Task and Off-Task behaviors
                </div>
              </div>
            )}

            {selectedFirstVisit === false && newVisitForm.type !== "fba" && (
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
                <option value="">Select...</option>
                <option value="fully">Yes</option>
                <option value="not">No</option>
                <option value="partially">Partially</option>
              </select>
              </div>
            )}

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
                    OK: {prior.length} prior {newVisitForm.type === "fba" ? "FBA " : ""}visit{prior.length !== 1 ? "s" : ""} found
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {newVisitForm.type === "fba"
                      ? `Last FBA: ${dateStr(prior[0].startTime)}`
                      : `Previous behaviors will be pre-loaded. Last visit: ${dateStr(prior[0].startTime)}`}
                    {newVisitForm.type !== "fba" && prior[0].recommendations && " | Has recommendations for follow-up"}
                  </div>
                </div>
              ) : null;
            })()}

            <button onClick={startVisit}
              disabled={
                !newVisitForm.subjectName.trim() ||
                !newVisitForm.observerName.trim() ||
                !newVisitForm.grade ||
                !newVisitForm.selectedDistrict ||
                (newVisitForm.selectedDistrict === "Other" && !newVisitForm.customDistrict.trim()) ||
                !newVisitForm.schoolName.trim() ||
                selectedFirstVisit === undefined ||
                (newVisitForm.type !== "fba" && selectedFirstVisit === false && !implementationStatus)
              }
              style={{
                width: "100%", background: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !newVisitForm.grade || !newVisitForm.selectedDistrict || (newVisitForm.selectedDistrict === "Other" && !newVisitForm.customDistrict.trim()) || !newVisitForm.schoolName.trim() || selectedFirstVisit === undefined || (newVisitForm.type !== "fba" && selectedFirstVisit === false && !implementationStatus))
                  ? "#1e293b" : "linear-gradient(135deg, #38bdf8, #818cf8)",
                color: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !newVisitForm.grade || !newVisitForm.selectedDistrict || (newVisitForm.selectedDistrict === "Other" && !newVisitForm.customDistrict.trim()) || !newVisitForm.schoolName.trim() || selectedFirstVisit === undefined || (newVisitForm.type !== "fba" && selectedFirstVisit === false && !implementationStatus)) ? "#475569" : "#0f172a",
                border: "none", borderRadius: 12, padding: "16px", fontSize: 16, fontWeight: 900,
                cursor: (!newVisitForm.subjectName.trim() || !newVisitForm.observerName.trim() || !newVisitForm.grade || !newVisitForm.selectedDistrict || (newVisitForm.selectedDistrict === "Other" && !newVisitForm.customDistrict.trim()) || !newVisitForm.schoolName.trim() || selectedFirstVisit === undefined || (newVisitForm.type !== "fba" && selectedFirstVisit === false && !implementationStatus)) ? "not-allowed" : "pointer"
              }}>Start Observation</button>
              </>
            )}
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
                <button key={t.id} onClick={() => { setTab(t.id as any); setScreen((t.id === "home" ? "home" : t.id) as any); }} style={{
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
                <button onClick={() => {
                  setImplementationStatus("");
                  setNewVisitForm({
                    type: "student",
                    subjectName: "",
                    observerName: "",
                    grade: "",
                    totalStudents: "",
                    selectedDistrict: "",
                    customDistrict: "",
                    schoolName: "",
                    isFirstVisit: undefined,
                  });
                  router.push("/?step=firstVisit");
                  setScreen("new-visit");
                  setTab("");
                }} style={{
                  width: "100%", background: "linear-gradient(135deg, #38bdf8, #818cf8)",
                  color: "#0f172a", border: "none", borderRadius: 14, padding: "20px",
                  fontSize: 18, fontWeight: 900, cursor: "pointer", marginBottom: 24,
                  boxShadow: "0 4px 20px #38bdf844"
                }}>+ Start New Observation</button>

                {allVisits.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>RECENT VISITS</div>
                    {allVisits.slice(0, 5).map(v => (
                      <VisitCard key={v.id} visit={v} onClick={() => setSelectedVisit(v)} onEdit={() => editVisit(v)} />
                    ))}
                    {allVisits.length > 5 && (
                      <button onClick={() => { setTab("history"); setScreen("history"); }} style={{
                        width: "100%", background: "none", border: "1px solid #334155",
                        color: "#64748b", borderRadius: 10, padding: "10px", fontSize: 13, cursor: "pointer", marginTop: 4
                      }}>View all {allVisits.length} visits &gt;</button>
                    )}
                  </>
                )}

                {allVisits.length === 0 && (
                  <div style={{
                    textAlign: "center", padding: "48px 24px", color: "#475569",
                    background: "#1e293b", borderRadius: 14, border: "1px dashed #334155"
                  }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>[ ]</div>
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
                  allVisits.map(v => <VisitCard key={v.id} visit={v} onClick={() => setSelectedVisit(v)} onEdit={() => editVisit(v)} />)
                )}
              </div>
            )}

            {/* Reports */}
            {tab === "reports" && <Reports visits={allVisits} />}
          </>
        )}
      </div>

      {/* Visit detail modal */}
      {selectedVisit && (
        <VisitDetail
          visit={selectedVisit}
          onClose={() => setSelectedVisit(null)}
          onEdit={() => editVisit(selectedVisit)}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0f172a" }} />}>
      <PageInner />
    </Suspense>
  );
}
