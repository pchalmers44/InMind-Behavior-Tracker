"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isObservationAdmin } from "@/lib/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { DeleteReportDialog, ReportToastMessage, TrashButton, type ReportToast } from "@/components/reports/DeleteReportControls";

type VisitRow = {
  id: string;
  type: string | null;
  subject_name: string | null;
  observer_name?: string | null;
  school_name: string | null;
  district: string | null;
  start_time?: number | string | null;
  total_duration?: number | null;
  implementation_status?: string | null;
  behaviors?: ReportBehavior[] | null;
};

type ReportBehavior = {
  label?: string | null;
  type?: string | null;
  category?: string | null;
  count?: number | null;
  durationSec?: number | null;
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

type ReportScope = "district" | "school";
type ReportDatePreset = "last7" | "last30" | "last90" | "schoolYear" | "custom";

type ChartDatum = {
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

function getUniqueDistricts(rows: VisitRow[]) {
  return uniqueSorted(rows.map((row) => row.district || ""));
}

function getUniqueSchools(rows: VisitRow[]) {
  return uniqueSorted(rows.map((row) => row.school_name || ""));
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
    const schoolYearStartMonth = 6;
    const startYear = today.getMonth() >= schoolYearStartMonth ? today.getFullYear() : today.getFullYear() - 1;
    start.setFullYear(startYear, schoolYearStartMonth, 1);
  }

  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

function getVisitStartMs(row: VisitRow) {
  if (!row.start_time) return null;
  const raw = row.start_time;
  const numeric = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  const date = new Date(numeric);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isVisitInReportDateRange(row: VisitRow, dateRange: ReportDateRange) {
  const startMs = dateRange.startDate ? new Date(`${dateRange.startDate}T00:00:00`).getTime() : undefined;
  const endMs = dateRange.endDate ? new Date(`${dateRange.endDate}T23:59:59.999`).getTime() : undefined;
  if (startMs == null && endMs == null) return true;
  const visitMs = getVisitStartMs(row);
  if (visitMs == null) return false;
  if (startMs != null && visitMs < startMs) return false;
  if (endMs != null && visitMs > endMs) return false;
  return true;
}

function filterReportVisits(rows: VisitRow[], scope: ReportScope, district: string, school: string, dateRange: ReportDateRange) {
  if (!district.trim()) return [];
  return rows.filter((row) => {
    if (row.district !== district) return false;
    if (scope === "school" && school && row.school_name !== school) return false;
    return isVisitInReportDateRange(row, dateRange);
  });
}

async function loadDistrictOptions(userId: string, canManageAllObservations: boolean) {
  let query = supabase
    .from("visits")
    .select("district")
    .limit(10000);

  if (!canManageAllObservations) query = query.eq("created_by", userId);

  const { data, error } = await query;

  if (error) throw error;
  return getUniqueDistricts((data || []) as VisitRow[]);
}

async function loadVisitsForDistrict(district: string, userId: string, canManageAllObservations: boolean) {
  if (!district.trim()) return [];

  let query = supabase
    .from("visits")
    .select("id, type, subject_name, observer_name, school_name, district, start_time, total_duration, implementation_status, behaviors")
    .eq("district", district)
    .order("start_time", { ascending: false })
    .limit(5000);

  if (!canManageAllObservations) query = query.eq("created_by", userId);

  const { data, error } = await query;

  if (error) throw error;
  return ((data || []) as VisitRow[]).filter((row) => {
    const type = (row.type || "").toLowerCase();
    return type === "student" || type === "classroom";
  });
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const sec = Math.round(seconds);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function ReportBarChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">{title}</div>
      {data.length === 0 ? (
        <div className="py-2 text-sm text-slate-600">No data yet.</div>
      ) : (
        <div className="grid gap-3">
          {data.map((d) => (
            <div key={d.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <div className="truncate text-slate-200">{d.label}</div>
                <div className="font-extrabold" style={{ color: d.color || "#38bdf8" }}>{d.value}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-950">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(4, (d.value / max) * 100)}%`,
                    background: d.color || "#38bdf8",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportMetadataPanel({ metadata }: { metadata: ReportMetadata }) {
  const rows = [
    { label: "Report Scope", value: metadata.reportScope },
    { label: "District", value: metadata.district || "Select a district" },
    { label: "School", value: metadata.school },
    { label: "Date Range", value: metadata.dateRange },
    { label: "Total Visits", value: metadata.totalVisits },
    { label: "Generated On", value: metadata.generatedOn },
  ];

  return (
    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="mb-4">
        <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{metadata.reportScope} Report</div>
        <div className="mt-1 text-xl font-black text-slate-100">{metadata.district || "No district selected"}</div>
        <div className="mt-1 text-sm text-slate-400">{metadata.school} | {metadata.dateRange}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{row.label}</div>
            <div className="mt-1 text-sm font-bold text-slate-100">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const canManageAllObservations = isObservationAdmin(user);
  const [reportScope, setReportScope] = useState<ReportScope>("district");
  const [school, setSchool] = useState("");
  const [district, setDistrict] = useState("");
  const [datePreset, setDatePreset] = useState<ReportDatePreset>("last30");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [schools, setSchools] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VisitRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<ReportToast>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      setError(null);
      if (!user?.id) {
        setDistricts([]);
        setLoadingOptions(false);
        return;
      }
      console.info("[reports] Loading district options from visits...");
      try {
        const nextDistricts = await loadDistrictOptions(user.id, canManageAllObservations);
        if (cancelled) return;
        setDistricts(nextDistricts);
      } catch (error) {
        if (cancelled) return;
        console.error("[reports] Failed to load district options:", error);
        setError(error instanceof Error ? error.message : "Failed to load district options.");
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canManageAllObservations, user?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!district.trim() || !user?.id) return;

    (async () => {
      setLoadingSchools(true);
      setError(null);
      console.info("[reports] Loading schools from visits for district:", district);
      try {
        const districtVisits = await loadVisitsForDistrict(district, user.id, canManageAllObservations);
        if (cancelled) return;
        setVisits(districtVisits);
        setSchools(getUniqueSchools(districtVisits));
      } catch (error) {
        if (cancelled) return;
        console.error("[reports] Failed to load schools for district:", error);
        setError(error instanceof Error ? error.message : "Failed to load schools for this district.");
      } finally {
        if (!cancelled) setLoadingSchools(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canManageAllObservations, district, user?.id]);

  const canDownload = useMemo(() => {
    return !loadingOptions && !loadingSchools && !downloading;
  }, [downloading, loadingOptions, loadingSchools]);

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
    () => filterReportVisits(visits, reportScope, district, school, reportDateRange),
    [district, reportDateRange, reportScope, school, visits]
  );
  const reportMetadata = useMemo<ReportMetadata>(() => ({
    reportScope: reportScope === "school" ? "School" : "District",
    district,
    school: reportScope === "school" && school ? school : "All Schools",
    dateRange: reportDateRangeLabel,
    totalVisits: selectedReportVisits.length,
    generatedOn: formatReportGeneratedOn(new Date()),
  }), [district, reportDateRangeLabel, reportScope, school, selectedReportVisits.length]);

  const summaryCards = useMemo(() => {
    if (reportScope !== "district" && reportScope !== "school") return [];

    const teachers = new Set(selectedReportVisits.filter((v) => (v.type || "").toLowerCase() === "classroom").map((v) => v.subject_name || "").filter(Boolean));
    const students = new Set(selectedReportVisits.filter((v) => (v.type || "").toLowerCase() === "student").map((v) => v.subject_name || "").filter(Boolean));
    const schoolsRepresented = new Set(selectedReportVisits.map((v) => v.school_name || "").filter(Boolean));
    const averageDuration = selectedReportVisits.length
      ? selectedReportVisits.reduce((sum, v) => sum + (v.total_duration || 0), 0) / selectedReportVisits.length
      : 0;

    if (reportScope === "district") {
      return [
        { label: "Total Schools", value: schoolsRepresented.size, color: "text-sky-300" },
        { label: "Total Teachers", value: teachers.size, color: "text-indigo-300" },
        { label: "Total Students", value: students.size, color: "text-emerald-300" },
        { label: "Total Observations", value: selectedReportVisits.length, color: "text-amber-300" },
      ];
    }

    return [
      { label: "Total Teachers", value: teachers.size, color: "text-sky-300" },
      { label: "Total Students", value: students.size, color: "text-emerald-300" },
      { label: "Total Observations", value: selectedReportVisits.length, color: "text-amber-300" },
      { label: "Avg. Duration", value: formatDuration(averageDuration), color: "text-indigo-300" },
    ];
  }, [reportScope, selectedReportVisits]);

  const chartData = useMemo(() => {
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
      const type = (visit.type || "").toLowerCase();
      if (visit.school_name) schoolCounts.set(visit.school_name, (schoolCounts.get(visit.school_name) || 0) + 1);
      typeCounts.set(type === "classroom" ? "Classroom" : "Student", (typeCounts.get(type === "classroom" ? "Classroom" : "Student") || 0) + 1);
      const rawStatus = (visit.implementation_status || "none").trim().toLowerCase();
      const status = rawStatus ? `${rawStatus.charAt(0).toUpperCase()}${rawStatus.slice(1)}` : "None";
      implementationCounts.set(status, (implementationCounts.get(status) || 0) + 1);

      for (const behavior of visit.behaviors || []) {
        const amount = behavior.type === "duration" ? (behavior.durationSec || 0) : (behavior.count || 0);
        const category = (behavior.category || "").toLowerCase();
        if (category === "positive") positive += amount;
        if (category === "challenging") challenging += amount;
        const label = behavior.label || "Unknown behavior";
        behaviorCounts.set(label, (behaviorCounts.get(label) || 0) + amount);
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

  const downloadExcel = async (format: "xlsx" | "csv" = "xlsx") => {
    setDownloading(true);
    setError(null);
    try {
      if ((reportScope === "district" || reportScope === "school") && !district.trim()) {
        throw new Error("Select a district before downloading this report.");
      }

      const params = new URLSearchParams();
      if ((reportScope === "district" || reportScope === "school") && district) params.set("district", district);
      if (reportScope === "school" && school) params.set("school", school);
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
      setError(e instanceof Error ? e.message : "Failed to download report.");
    } finally {
      setDownloading(false);
    }
  };

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

      setVisits((prev) => prev.filter((visit) => visit.id !== deleteTarget.id));
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
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">Reports</h1>
          <Link
            href="/fba-reports"
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500"
          >
            FBA Reports
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Filter observation data and download a report.
        </p>

        <div className="mt-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">REPORT SCOPE</label>
            <select
              value={reportScope}
              onChange={(e) => {
                setReportScope(e.target.value as ReportScope);
                setSchool("");
                setDistrict("");
                setSchools([]);
                setVisits([]);
                setLoadingSchools(false);
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="district">District</option>
              <option value="school">School</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">DISTRICT</label>
            <select
              value={district}
              onChange={(e) => {
                setDistrict(e.target.value);
                setSchool("");
                setSchools([]);
                setVisits([]);
                setLoadingSchools(false);
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">{loadingOptions ? "Loading..." : "Select district..."}</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {reportScope === "school" && (
          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">SCHOOL</label>
            <select
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              disabled={!district}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <option value="">
                {!district ? "Select a district first" : loadingSchools ? "Loading schools..." : "All Schools"}
              </option>
              {schools.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {district && !loadingSchools && schools.length === 0 && (
              <div className="text-xs text-slate-500">No schools found for this district.</div>
            )}
          </div>
          )}

          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">DATE RANGE</label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as ReportDatePreset)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
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
              <div className="grid gap-2">
                <label className="text-xs font-bold tracking-widest text-slate-400">START DATE</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-bold tracking-widest text-slate-400">END DATE</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadExcel("xlsx")}
              disabled={!canDownload || !district.trim()}
              className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {downloading ? "Generating..." : "Generate Report"}
            </button>
            {isOrganizationalScope && (
              <button
                type="button"
                onClick={() => downloadExcel("csv")}
                disabled={!canDownload || !district.trim()}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
              >
                {downloading ? "Generating..." : "Download CSV"}
              </button>
            )}
          </div>
        </div>

        <ReportMetadataPanel metadata={reportMetadata} />

        {summaryCards.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
                <div className="mt-1 text-xs text-slate-500">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {chartData && (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {reportScope === "district" && (
              <ReportBarChart title="Observations by School" data={chartData.observationsBySchool} />
            )}
            <ReportBarChart title="Positive vs Challenging Behaviors" data={chartData.behaviorBalance} />
            <ReportBarChart title="Observation Types" data={chartData.observationTypes} />
            <ReportBarChart title="Implementation Status" data={chartData.implementationStatus} />
            {reportScope === "school" && (
              <ReportBarChart title="Most Frequent Behaviors" data={chartData.frequentBehaviors} />
            )}
          </div>
        )}

        {selectedReportVisits.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Observations</div>
            <div className="grid gap-2">
              {selectedReportVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-extrabold text-slate-100">{visit.subject_name || "Untitled observation"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(visit.type || "Observation").toLowerCase() === "classroom" ? "Classroom" : "Student"} |{" "}
                      {visit.school_name || "No school"} | {formatReportDisplayDate(
                        getVisitStartMs(visit) ? formatDateInput(new Date(getVisitStartMs(visit) as number)) : undefined
                      )}
                      {visit.observer_name ? ` | ${visit.observer_name}` : ""}
                    </div>
                  </div>
                  {canManageAllObservations && (
                    <TrashButton
                      onClick={() => setDeleteTarget(visit)}
                      disabled={isDeleting}
                      className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-red-900 bg-red-950 text-red-300 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 text-xs text-slate-500">
          Note: Filters are applied server-side in <code className="rounded bg-slate-900 px-1">/api/reports</code>.
        </div>
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
