"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type VisitRow = {
  type: string | null;
  subject_name: string | null;
  school_name: string | null;
  district: string | null;
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

export default function ReportsPage() {
  const [student, setStudent] = useState("");
  const [teacher, setTeacher] = useState("");
  const [school, setSchool] = useState("");
  const [district, setDistrict] = useState("");

  const [students, setStudents] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [schools, setSchools] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      setError(null);
      const { data, error } = await supabase
        .from("visits")
        .select("type, subject_name, school_name, district")
        .limit(5000);

      if (cancelled) return;
      if (error) {
        setError(error.message || "Failed to load filter options.");
        setLoadingOptions(false);
        return;
      }

      const rows = (data || []) as VisitRow[];
      const studentNames: string[] = [];
      const teacherNames: string[] = [];
      const schoolNames: string[] = [];
      const districtNames: string[] = [];

      for (const r of rows) {
        const subject = r.subject_name || "";
        const t = (r.type || "").toLowerCase();
        if (t === "student") studentNames.push(subject);
        if (t === "classroom") teacherNames.push(subject);
        if (r.school_name) schoolNames.push(r.school_name);
        if (r.district) districtNames.push(r.district);
      }

      setStudents(uniqueSorted(studentNames));
      setTeachers(uniqueSorted(teacherNames));
      setSchools(uniqueSorted(schoolNames));
      setDistricts(uniqueSorted(districtNames));
      setLoadingOptions(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const canDownload = useMemo(() => {
    return !loadingOptions && !downloading;
  }, [downloading, loadingOptions]);

  const downloadExcel = async () => {
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (student.trim()) params.set("student", student.trim());
      if (teacher.trim()) params.set("teacher", teacher.trim());
      if (school) params.set("school", school);
      if (district) params.set("district", district);

      const res = await fetch(`/api/reports?${params.toString()}`, { method: "GET" });
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);

      const blob = await res.blob();
      const filename = "observations-report.xlsx";

      const nav = window.navigator as any;
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight">Reports</h1>
        <p className="mt-2 text-sm text-slate-400">
          Filter observation data and download an Excel report.
        </p>

        <div className="mt-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">STUDENT</label>
            <input
              list="student-options"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
              placeholder={loadingOptions ? "Loading..." : "Search student..."}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <datalist id="student-options">
              {students.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">TEACHER</label>
            <input
              list="teacher-options"
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              placeholder={loadingOptions ? "Loading..." : "Search teacher..."}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <datalist id="teacher-options">
              {teachers.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">DISTRICT</label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">All districts</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-bold tracking-widest text-slate-400">SCHOOL</label>
            <select
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={downloadExcel}
              disabled={!canDownload}
              className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {downloading ? "Generating..." : "Download Excel"}
            </button>
            <button
              type="button"
              onClick={downloadExcel}
              disabled={!canDownload}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
            >
              Run Report
            </button>
          </div>
        </div>

        <div className="mt-6 text-xs text-slate-500">
          Note: Filters are applied server-side in <code className="rounded bg-slate-900 px-1">/api/reports</code>.
        </div>
      </div>
    </div>
  );
}
