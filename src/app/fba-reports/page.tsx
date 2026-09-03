"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react/no-unescaped-entities */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isObservationAdmin } from "@/lib/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { DeleteReportDialog, ReportToastMessage, TrashButton, type ReportToast } from "@/components/reports/DeleteReportControls";
import { buildIntensityTrendLabel, normalizeBehaviorOccurrences } from "@/lib/behavior-intensity";

type Behavior = {
  id: string;
  label: string;
  type: string;
  category?: "positive" | "challenging";
  count?: number;
  intensity?: number | null;
  occurrences?: unknown;
  intensityRecords?: unknown;
  durationSec?: number;
};

type SupabaseDeleteError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function formatDeleteFailedMessage(error: SupabaseDeleteError) {
  return [
    "Delete failed",
    "",
    "Code:",
    error.code || "none",
    "",
    "Message:",
    error.message || "none",
    "",
    "Details:",
    error.details || "none",
    "",
    "Hint:",
    error.hint || "none",
  ].join("\n");
}

type AbcEntry = { antecedent: string; behavior: string; consequence: string };

type FbaLatencyEvent = {
  behaviorId: string | null;
  behaviorLabel: string;
  startTime: number;
  stopTime: number;
  latencySec: number;
  timestamp: number;
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

type FbaVisitRow = {
  id: string;
  type: string | null;
  subject_name: string | null;
  observer_name: string | null;
  grade: string | null;
  district: string | null;
  school_name: string | null;
  start_time: number | string | null;
  end_time: number | string | null;
  total_duration: number | null;
  abc_entries: AbcEntry[] | null;
  behaviors: Behavior[] | null;
  fba_latency_events: FbaLatencyEvent[] | null;
  fba_interval_sessions: FbaIntervalSession[] | null;
};

function norm(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueSorted(values: string[]) {
  const map = new Map<string, string>();
  for (const v of values) {
    const raw = v.trim();
    if (!raw) continue;
    const k = norm(raw);
    if (!map.has(k)) map.set(k, raw);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function toMs(value: number | string | null) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dateLabel(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (value < 60) return `${Math.round(value)}s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return `${m}m ${s}s`;
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function MiniLineChart({
  points,
  height = 64,
  stroke = "#38bdf8",
}: {
  points: number[];
  height?: number;
  stroke?: string;
}) {
  const width = 280;
  const safe = points.filter((p) => Number.isFinite(p));
  const max = safe.length ? Math.max(...safe) : 1;
  const min = safe.length ? Math.min(...safe) : 0;
  const span = max - min || 1;

  const path = points
    .map((v, i) => {
      const x = points.length <= 1 ? 0 : (i / (points.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      const cmd = i === 0 ? "M" : "L";
      return `${cmd}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend chart">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="#334155" strokeWidth="1" />
    </svg>
  );
}

export default function FbaReportsPage() {
  const { user } = useAuth();
  const canManageAllObservations = isObservationAdmin(user);
  const [student, setStudent] = useState("");
  const [behavior, setBehavior] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [students, setStudents] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<FbaVisitRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<FbaVisitRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<ReportToast>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      setError(null);
      if (!user?.id) {
        setStudents([]);
        setLoadingOptions(false);
        return;
      }
      console.info("[fba-reports] Loading student options (type=fba)...");
      let query = supabase
        .from("visits")
        .select("subject_name, type, start_time")
        .eq("type", "fba")
        .order("start_time", { ascending: false })
        .limit(10000);

      if (!canManageAllObservations) query = query.eq("created_by", user.id);

      const { data, error } = await query;

      if (cancelled) return;
      if (error) {
        console.error("[fba-reports] Failed to load student options:", {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
          raw: error,
        });
        setError(error.message || "Failed to load student options.");
        setLoadingOptions(false);
        return;
      }

      const names = uniqueSorted((data || []).map((r: any) => String(r.subject_name || "").trim()).filter(Boolean));
      setStudents(names);
      setLoadingOptions(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [canManageAllObservations, user?.id]);

  const canRun = useMemo(() => {
    return !loading && student.trim().length > 0;
  }, [loading, student]);

  const runReport = async () => {
    const studentName = student.trim();
    if (!studentName) return;
    if (!user?.id) {
      setError("Sign in again before running this report.");
      return;
    }

    setLoading(true);
    setError(null);
    console.info("[fba-reports] Run report", { student: studentName, startDate, endDate, behavior });
    try {
      let query = supabase
        .from("visits")
        .select(
          "id, type, subject_name, observer_name, grade, district, school_name, start_time, end_time, total_duration, abc_entries, behaviors, fba_latency_events, fba_interval_sessions"
        )
        .eq("type", "fba")
        .eq("subject_name", studentName)
        .order("start_time", { ascending: true })
        .limit(5000);

      if (!canManageAllObservations) query = query.eq("created_by", user.id);

      if (startDate) {
        const ms = new Date(`${startDate}T00:00:00`).getTime();
        if (Number.isFinite(ms)) query = query.gte("start_time", ms);
      }
      if (endDate) {
        const ms = new Date(`${endDate}T23:59:59`).getTime();
        if (Number.isFinite(ms)) query = query.lte("start_time", ms);
      }

      const { data, error } = await query;
      if (error) {
        console.error("[fba-reports] Query error:", {
          message: error.message,
          details: (error as any).details,
          hint: (error as any).hint,
          code: (error as any).code,
          raw: error,
        });
        setError(error.message || "Failed to load FBA sessions.");
        setSessions([]);
        return;
      }

      const rows = (Array.isArray(data) ? data : []) as unknown as FbaVisitRow[];
      setSessions(rows);
      console.info("[fba-reports] Loaded sessions:", rows.length);
    } catch (e) {
      console.error("[fba-reports] Exception while running report:", e);
      setError(e instanceof Error ? e.message : "Failed to run report.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const behaviorOptions = useMemo(() => {
    const opts: string[] = [];
    for (const s of sessions) {
      for (const b of s.behaviors || []) opts.push(b.label);
      for (const e of s.fba_latency_events || []) opts.push(e.behaviorLabel);
      for (const sess of s.fba_interval_sessions || []) opts.push(sess.behaviorLabel);
    }
    return uniqueSorted(opts);
  }, [sessions]);

  const computed = useMemo(() => {
    const behaviorFilter = behavior.trim();
    const hasBehaviorFilter = Boolean(behaviorFilter);
    const sessionsSorted = [...sessions].sort((a, b) => (toMs(a.start_time) || 0) - (toMs(b.start_time) || 0));

    const perSession = sessionsSorted.map((s) => {
      const startMs = toMs(s.start_time);
      const abc = (s.abc_entries || []) as AbcEntry[];
      const behaviors = (s.behaviors || []) as Behavior[];

      const freqTotal = behaviors
        .filter((b) => b.type === "frequency" && (!hasBehaviorFilter || b.label === behaviorFilter))
        .reduce((sum, b) => sum + (b.count || 0), 0);

      const durationTotalSec = behaviors
        .filter((b) => b.type === "duration" && (!hasBehaviorFilter || b.label === behaviorFilter))
        .reduce((sum, b) => sum + (b.durationSec || 0), 0);

      const intensityRecords = behaviors
        .filter((b) => !hasBehaviorFilter || b.label === behaviorFilter)
        .flatMap((b) => normalizeBehaviorOccurrences(b));
      const intensityValues = intensityRecords
        .map((record) => record.intensity)
        .filter((intensity): intensity is number => typeof intensity === "number" && Number.isFinite(intensity));
      const intensityAvg =
        intensityValues.length > 0 ? intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length : null;
      const intensityHigh = intensityValues.length > 0 ? Math.max(...intensityValues) : null;
      const intensityLow = intensityValues.length > 0 ? Math.min(...intensityValues) : null;
      const intensityTrend = buildIntensityTrendLabel(intensityValues);

      const latencyEvents = (s.fba_latency_events || []) as FbaLatencyEvent[];
      const latencyFiltered = latencyEvents.filter((e) => !hasBehaviorFilter || e.behaviorLabel === behaviorFilter);
      const avgLatency =
        latencyFiltered.length > 0
          ? latencyFiltered.reduce((sum, e) => sum + (e.latencySec || 0), 0) / latencyFiltered.length
          : 0;

      const intervalSessions = (s.fba_interval_sessions || []) as FbaIntervalSession[];
      const intervalFiltered = intervalSessions.filter((sess) => !hasBehaviorFilter || sess.behaviorLabel === behaviorFilter);
      const intervalRecords = intervalFiltered.flatMap((sess) => sess.records || []);
      const intervalTotal = intervalRecords.length;
      const intervalYes = intervalRecords.filter((r) => r.behaviorPresent).length;
      const intervalPct = intervalTotal > 0 ? intervalYes / intervalTotal : 0;

      return {
        id: s.id,
        startMs,
        startLabel: dateLabel(startMs),
        abcEntries: abc,
        freqTotal,
        durationTotalSec,
        intensityTotal: intensityRecords.length,
        intensityRated: intensityValues.length,
        intensityAvg,
        intensityHigh,
        intensityLow,
        intensityTrend,
        avgLatencySec: avgLatency,
        intervalPct,
        intervalTotal,
      };
    });

    return {
      perSession,
      charts: {
        freq: perSession.map((p) => p.freqTotal),
        duration: perSession.map((p) => p.durationTotalSec),
        intensity: perSession.map((p) => p.intensityAvg ?? 0),
        latency: perSession.map((p) => p.avgLatencySec),
        intervalPct: perSession.map((p) => Math.round(p.intervalPct * 100)),
        labels: perSession.map((p) => p.startLabel || ""),
      },
    };
  }, [sessions, behavior]);

  const confirmDeleteReport = async () => {
    if (!deleteTarget) return;
    if (!canManageAllObservations) {
      setToast({ type: "error", message: "You do not have permission to delete reports." });
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      const { data: deletedRows, error: deleteError } = await supabase
        .from("visits")
        .delete()
        .eq("id", deleteTarget.id)
        .select("id");

      if (deleteError) {
        console.error("DELETE ERROR:", deleteError);
        throw new Error(formatDeleteFailedMessage(deleteError));
      }
      if (!deletedRows?.length) throw new Error("Report was not deleted.");

      setSessions((prev) => prev.filter((session) => session.id !== deleteTarget.id));
      setDeleteTarget(null);
      setToast({ type: "success", message: "Report deleted successfully." });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed to delete report.";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setIsDeleting(false);
      window.setTimeout(() => setToast(null), 3200);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">FBA Reports</h1>
            <p className="mt-2 text-sm text-slate-400">
              Student-only reporting for Functional Behavior Assessments (FBA).
            </p>
          </div>
          <Link
            href="/reports"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500"
          >
            Back to Reports
          </Link>
        </div>

        <div className="mt-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">STUDENT (REQUIRED)</label>
            <input
              list="fba-student-options"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
              placeholder={loadingOptions ? "Loading..." : "Search student..."}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <datalist id="fba-student-options">
              {students.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs font-bold tracking-widest text-slate-400">START DATE</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-bold tracking-widest text-slate-400">END DATE</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-bold tracking-widest text-slate-400">BEHAVIOR</label>
              <select
                value={behavior}
                onChange={(e) => setBehavior(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="">All behaviors</option>
                {behaviorOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runReport}
              disabled={!canRun}
              className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {loading ? "Loading..." : "Run FBA Report"}
            </button>
            <div className="text-xs text-slate-500 self-center">
              Query: <code className="rounded bg-slate-900 px-1">visits</code> where{" "}
              <code className="rounded bg-slate-900 px-1">type='fba'</code> and{" "}
              <code className="rounded bg-slate-900 px-1">subject_name=student</code>
            </div>
          </div>
        </div>

        {computed.perSession.length > 0 && (
          <>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="text-xs font-bold tracking-widest text-slate-400">FREQUENCY TREND</div>
                <div className="mt-3">
                  <MiniLineChart points={computed.charts.freq} stroke="#818cf8" />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="text-xs font-bold tracking-widest text-slate-400">DURATION TREND (SEC)</div>
                <div className="mt-3">
                  <MiniLineChart points={computed.charts.duration} stroke="#34d399" />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="text-xs font-bold tracking-widest text-slate-400">LATENCY TREND (AVG SEC)</div>
                <div className="mt-3">
                  <MiniLineChart points={computed.charts.latency} stroke="#f59e0b" />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="text-xs font-bold tracking-widest text-slate-400">INTERVAL OCCURRENCE TREND (%)</div>
                <div className="mt-3">
                  <MiniLineChart points={computed.charts.intervalPct} stroke="#f87171" />
                </div>
              </div>
            </div>

            <div className="mt-10">
              <h2 className="text-lg font-extrabold tracking-tight">Sessions</h2>
              <p className="mt-1 text-sm text-slate-400">
                Comparison across multiple FBA sessions for the selected student.
              </p>

              <div className="mt-4 grid gap-3">
                {computed.perSession.map((s, idx) => {
                  const sessionRow = sessions.find((session) => session.id === s.id) ?? null;
                  return (
                  <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-extrabold">
                          Session {idx + 1} {s.startLabel ? `- ${s.startLabel}` : ""}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          ABC entries: {s.abcEntries.length} | Interval samples: {s.intervalTotal}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                          <div className="text-[10px] font-bold tracking-widest text-slate-500">FREQ</div>
                          <div className="text-lg font-extrabold text-indigo-300">{s.freqTotal}</div>
                        </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">DUR</div>
                        <div className="text-lg font-extrabold text-emerald-300">{formatSeconds(s.durationTotalSec)}</div>
                      </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                      <div className="text-[10px] font-bold tracking-widest text-slate-500">INT AVG</div>
                      <div className="text-lg font-extrabold text-rose-300">
                        {s.intensityAvg != null ? s.intensityAvg.toFixed(1) : "-"}
                      </div>
                    </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">LAT</div>
                        <div className="text-lg font-extrabold text-amber-300">{formatSeconds(s.avgLatencySec)}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">INT</div>
                        <div className="text-lg font-extrabold text-rose-300">
                          {Math.round(clamp01(s.intervalPct) * 100)}%
                        </div>
                      </div>
                        </div>
                        {canManageAllObservations && sessionRow && (
                          <TrashButton
                            onClick={() => setDeleteTarget(sessionRow)}
                            disabled={isDeleting}
                            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-red-900 bg-red-950 text-red-300 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        )}
                    </div>
                  </div>

                  {s.intensityTotal > 0 && (
                    <div className="mt-4 grid gap-2 rounded-lg border border-slate-800 bg-slate-950/20 p-3 sm:grid-cols-4">
                      <div>
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">INT OCCURRENCES</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-100">{s.intensityTotal}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">HIGH</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-100">
                          {s.intensityHigh != null ? s.intensityHigh : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">LOW</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-100">
                          {s.intensityLow != null ? s.intensityLow : "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold tracking-widest text-slate-500">TREND</div>
                        <div className="mt-1 text-sm font-extrabold text-slate-100">{s.intensityTrend}</div>
                      </div>
                    </div>
                  )}

                    {s.abcEntries.length > 0 && (
                      <div className="mt-4 grid gap-2">
                        <div className="text-xs font-bold tracking-widest text-slate-400">ABC ENTRIES</div>
                        <div className="grid gap-2">
                          {s.abcEntries.map((e, i) => (
                            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                              <div className="text-[10px] font-bold tracking-widest text-slate-500">ENTRY {i + 1}</div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <div>
                                  <div className="text-[10px] font-bold tracking-widest text-slate-500">ANTECEDENT</div>
                                  <div className="mt-1 text-sm text-slate-100">{e.antecedent || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold tracking-widest text-slate-500">BEHAVIOR</div>
                                  <div className="mt-1 text-sm text-slate-100">{e.behavior || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold tracking-widest text-slate-500">CONSEQUENCE</div>
                                  <div className="mt-1 text-sm text-slate-100">{e.consequence || "-"}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            </div>
          </>
        )}
        <ReportToastMessage toast={toast} />
        {deleteTarget && (
          <DeleteReportDialog
            isDeleting={isDeleting}
            onCancel={() => {
              if (!isDeleting) setDeleteTarget(null);
            }}
            onConfirm={confirmDeleteReport}
          />
        )}
      </div>
    </div>
  );
}
