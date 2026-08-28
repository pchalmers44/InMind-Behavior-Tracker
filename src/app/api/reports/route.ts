import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isObservationAdmin } from "@/lib/permissions";

type ObservationRow = {
  id: string;
  student_name: string | null;
  teacher_name: string | null;
  school: string | null;
  district: string | null;
  behavior: string | null;
  duration: number | string | null;
  created_at: string | null;
  observation_type?: string | null;
  type?: string | null;
};

type ReportBehavior = {
  label?: string | null;
  type?: string | null;
  category?: "positive" | "challenging" | string | null;
  count?: number | null;
  durationSec?: number | null;
  intensity?: number | null;
  occurrences?: Array<{ intensity?: number | null }> | null;
};

type VisitReportRow = {
  id: string;
  type?: string | null;
  observation_type?: string | null;
  subject_name?: string | null;
  observer_name?: string | null;
  school_name?: string | null;
  district?: string | null;
  start_time?: number | string | null;
  total_duration?: number | null;
  behaviors?: ReportBehavior[] | null;
  implementation_status?: string | null;
  notes?: string | null;
  recommendations?: string | null;
};

type SupabaseReportsClient = SupabaseClient;

type OrganizationalReportScope = {
  district: string;
  school?: string;
  dateRangeLabel?: string;
};

type ReportDateRange = {
  startMs?: number;
  endMs?: number;
};

type SummaryRow = { metric: string; value: string | number };
type BehaviorSummaryRow = {
  behavior: string;
  category: string;
  measure: string;
  total: string | number;
  visits: number;
  average: string | number;
};
type BreakdownRow = Record<string, string | number>;

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function getBearerToken(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function durationToString(value: ObservationRow["duration"]) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return `${value} min`;
  const s = String(value).trim();
  return s ? s : "";
}

function secondsToDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const sec = Math.round(totalSeconds);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function uniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.map((v) => (v || "").trim()).filter(Boolean)).size;
}

function getVisitType(row: VisitReportRow) {
  return (row.observation_type || row.type || "").trim().toLowerCase();
}

function behaviorValue(behavior: ReportBehavior) {
  if (behavior.type === "duration") return behavior.durationSec || 0;
  return behavior.count || 0;
}

function behaviorIntensitySummary(behavior: ReportBehavior) {
  const values = (behavior.occurrences || [])
    .map((record) => record.intensity)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (typeof behavior.intensity === "number" && Number.isFinite(behavior.intensity)) {
    values.push(behavior.intensity);
  }
  if (!values.length) return { average: "", highest: "" };
  return {
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
    highest: Math.max(...values),
  };
}

function addAutoFit(worksheet: ExcelJS.Worksheet) {
  for (let i = 1; i <= worksheet.columnCount; i++) {
    const col = worksheet.getColumn(i);
    const header = String(col.header ?? "");
    let max = header.length;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      if (s.length > max) max = s.length;
    });
    col.width = Math.min(60, Math.max(col.width ?? 10, max + 2));
  }
}

function dateFromVisit(row: VisitReportRow) {
  if (!row.start_time) return null;
  const raw = row.start_time;
  const numeric = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateBoundary(value: string | null, boundary: "start" | "end") {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (boundary === "start") date.setHours(0, 0, 0, 0);
  else date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function getDateRangeFromParams(searchParams: URLSearchParams): ReportDateRange {
  return {
    startMs: parseDateBoundary(searchParams.get("startDate"), "start"),
    endMs: parseDateBoundary(searchParams.get("endDate"), "end"),
  };
}

function getDateRangeLabelFromParams(searchParams: URLSearchParams) {
  const label = searchParams.get("dateRangeLabel");
  return label?.trim() || undefined;
}

function isVisitInDateRange(row: VisitReportRow, dateRange: ReportDateRange) {
  const date = dateFromVisit(row);
  if (!date) return false;
  const time = date.getTime();
  if (dateRange.startMs != null && time < dateRange.startMs) return false;
  if (dateRange.endMs != null && time > dateRange.endMs) return false;
  return true;
}

function filterOrganizationalVisits(rows: VisitReportRow[], dateRange: ReportDateRange) {
  return rows.filter((row) => {
    const type = getVisitType(row);
    if (type !== "student" && type !== "classroom") return false;
    if (dateRange.startMs != null || dateRange.endMs != null) return isVisitInDateRange(row, dateRange);
    return true;
  });
}

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString("en-US") : "";
}

function formatGeneratedOn(date: Date) {
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateRange(rows: VisitReportRow[]) {
  const dates = rows.map(dateFromVisit).filter((date): date is Date => Boolean(date));
  if (!dates.length) return "All dates";
  const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
  const first = formatDate(sorted[0]);
  const last = formatDate(sorted[sorted.length - 1]);
  return first === last ? first : `${first} - ${last}`;
}

function csvEscape(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvTable(title: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return [title, "No data"].join("\n");
  const headers = Object.keys(rows[0]);
  return [
    title,
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildOrganizationalReportData(rows: VisitReportRow[], scope: OrganizationalReportScope) {
  const behaviorTotals = new Map<string, { total: number; visits: number; type: string; category: string }>();
  const implementationTotals = new Map<string, number>();
  const typeCounts = new Map<string, number>([
    ["student", 0],
    ["classroom", 0],
  ]);
  const schoolTotals = new Map<string, { total: number; student: number; classroom: number; duration: number }>();
  const teacherTotals = new Map<string, number>();
  const studentTotals = new Map<string, number>();

  let positiveBehaviors = 0;
  let challengingBehaviors = 0;
  let totalDuration = 0;

  for (const row of rows) {
    const type = getVisitType(row);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    totalDuration += row.total_duration || 0;

    if (type === "classroom" && row.subject_name) {
      teacherTotals.set(row.subject_name, (teacherTotals.get(row.subject_name) || 0) + 1);
    }
    if (type === "student" && row.subject_name) {
      studentTotals.set(row.subject_name, (studentTotals.get(row.subject_name) || 0) + 1);
    }

    const schoolName = row.school_name || "Unknown school";
    const schoolTotal = schoolTotals.get(schoolName) || { total: 0, student: 0, classroom: 0, duration: 0 };
    schoolTotal.total += 1;
    schoolTotal.duration += row.total_duration || 0;
    if (type === "student") schoolTotal.student += 1;
    if (type === "classroom") schoolTotal.classroom += 1;
    schoolTotals.set(schoolName, schoolTotal);

    const implementation = (row.implementation_status || "none").trim().toLowerCase() || "none";
    implementationTotals.set(implementation, (implementationTotals.get(implementation) || 0) + 1);

    for (const behavior of row.behaviors || []) {
      const label = (behavior.label || "Unknown behavior").trim();
      const value = behaviorValue(behavior);
      const category = (behavior.category || "uncategorized").trim().toLowerCase();
      const current = behaviorTotals.get(label) || {
        total: 0,
        visits: 0,
        type: behavior.type || "frequency",
        category,
      };
      current.total += value;
      current.visits += 1;
      behaviorTotals.set(label, current);

      if (category === "positive") positiveBehaviors += value;
      if (category === "challenging") challengingBehaviors += value;
    }
  }

  const summaryRows: SummaryRow[] = [
    { metric: "Report Scope", value: scope.school ? "School" : "District" },
    { metric: "District", value: scope.district },
    { metric: "School", value: scope.school || "All Schools" },
    { metric: "Date Range", value: scope.dateRangeLabel || formatDateRange(rows) },
    { metric: "Total Visits", value: rows.length },
    { metric: "Generated On", value: formatGeneratedOn(new Date()) },
    { metric: scope.school ? "Total Observations" : "Observation Totals", value: rows.length },
    ...(scope.school ? [] : [{ metric: "Schools Represented", value: uniqueCount(rows.map((r) => r.school_name)) }]),
    { metric: "Teachers Observed", value: teacherTotals.size },
    { metric: "Students Observed", value: studentTotals.size },
    { metric: "Positive Behaviors", value: positiveBehaviors },
    { metric: "Challenging Behaviors", value: challengingBehaviors },
    { metric: scope.school ? "Average Duration" : "Average Observation Duration", value: secondsToDuration(rows.length ? totalDuration / rows.length : 0) },
  ];

  const behaviorRows: BehaviorSummaryRow[] = Array.from(behaviorTotals.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([label, data]) => {
      const isDuration = data.type === "duration";
      return {
        behavior: label,
        category: data.category,
        measure: isDuration ? "Duration" : "Frequency",
        total: isDuration ? secondsToDuration(data.total) : data.total,
        visits: data.visits,
        average: isDuration
          ? secondsToDuration(data.visits ? data.total / data.visits : 0)
          : data.visits ? Number((data.total / data.visits).toFixed(1)) : 0,
      };
    });

  const implementationRows: BreakdownRow[] = Array.from(implementationTotals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, count]) => ({
      Status: status,
      Count: count,
      Percentage: rows.length ? `${Math.round((count / rows.length) * 100)}%` : "0%",
    }));

  const typeRows: BreakdownRow[] = Array.from(typeCounts.entries()).map(([type, count]) => ({
    "Observation Type": type,
    Count: count,
  }));

  const schoolRows: BreakdownRow[] = Array.from(schoolTotals.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([schoolName, totals]) => ({
      School: schoolName,
      "Total Observations": totals.total,
      "Student Observations": totals.student,
      "Classroom Observations": totals.classroom,
      "Average Duration": secondsToDuration(totals.total ? totals.duration / totals.total : 0),
    }));

  const teacherRows: BreakdownRow[] = Array.from(teacherTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([teacher, count]) => ({ Teacher: teacher, Observations: count }));

  const studentRows: BreakdownRow[] = Array.from(studentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([student, count]) => ({ Student: student, Observations: count }));

  const observationRows: BreakdownRow[] = [];
  for (const row of rows) {
    const type = getVisitType(row);
    const dateValue = dateFromVisit(row);
    const behaviors = row.behaviors?.length ? row.behaviors : [{ label: "", type: "duration", durationSec: row.total_duration || 0 }];
    for (const behavior of behaviors) {
      const intensity = behaviorIntensitySummary(behavior);
      observationRows.push({
        Date: formatDate(dateValue),
        Student: type === "student" ? row.subject_name ?? "" : "",
        Teacher: type === "classroom" ? row.subject_name ?? "" : "",
        School: row.school_name ?? "",
        District: row.district ?? "",
        Behavior: behavior.label ?? "",
        Frequency: behavior.type === "frequency" ? behavior.count ?? 0 : "",
        Duration: behavior.type === "duration" ? secondsToDuration(behavior.durationSec || 0) : "",
        "Average Intensity": intensity.average,
        "Highest Intensity": intensity.highest,
        "Implementation Status": row.implementation_status ?? "",
        Notes: row.notes ?? "",
        Recommendations: row.recommendations ?? "",
      });
    }
  }

  return {
    summaryRows,
    behaviorRows,
    implementationRows,
    typeRows,
    schoolRows,
    teacherRows,
    studentRows,
    observationRows,
  };
}

async function buildOrganizationalExport(
  supabase: SupabaseReportsClient,
  scope: OrganizationalReportScope,
  format: string,
  dateRange: ReportDateRange,
  userId: string,
  canManageAllObservations: boolean
) {
  let query = supabase
    .from("visits")
    .select("*")
    .eq("district", scope.district)
    .order("start_time", { ascending: false })
    .limit(10000);

  if (!canManageAllObservations) query = query.eq("created_by", userId);
  if (scope.school) query = query.eq("school_name", scope.school);

  const { data, error } = await query;

  if (error) {
    console.error("Supabase organizational reports query error:", error);
    return NextResponse.json({ ok: false, error: "Failed to fetch report visits." }, { status: 500 });
  }

  const rows = filterOrganizationalVisits((Array.isArray(data) ? data : []) as unknown as VisitReportRow[], dateRange);

  const report = buildOrganizationalReportData(rows, scope);
  const filenamePrefix = scope.school ? "school-report" : "district-report";

  if (format === "csv") {
    const csv = [
      csvTable("Summary", report.summaryRows.map((row) => ({ Metric: row.metric, Value: row.value }))),
      csvTable("Behavior Summaries", report.behaviorRows.map((row) => ({
        Behavior: row.behavior,
        Category: row.category,
        Measure: row.measure,
        Total: row.total,
        Observations: row.visits,
        Average: row.average,
      }))),
      csvTable("Implementation Percentages", report.implementationRows),
      csvTable("Observation Type Breakdown", report.typeRows),
      ...(scope.school ? [] : [csvTable("School Breakdown", report.schoolRows)]),
      csvTable("Teacher Totals", report.teacherRows),
      ...(scope.school ? [csvTable("Student Totals", report.studentRows)] : []),
      csvTable("Observations", report.observationRows),
    ].join("\n\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenamePrefix}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "InMind Observer";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 32 },
    { header: "Value", key: "value", width: 28 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRows(report.summaryRows);

  const behaviorSheet = workbook.addWorksheet("Behavior Summaries");
  behaviorSheet.columns = [
    { header: "Behavior", key: "behavior", width: 28 },
    { header: "Category", key: "category", width: 16 },
    { header: "Measure", key: "measure", width: 16 },
    { header: "Total", key: "total", width: 14 },
    { header: "Observations", key: "visits", width: 14 },
    { header: "Average", key: "average", width: 14 },
  ];
  behaviorSheet.getRow(1).font = { bold: true };
  behaviorSheet.addRows(report.behaviorRows);

  const implementationSheet = workbook.addWorksheet("Implementation Percentages");
  implementationSheet.columns = [
    { header: "Status", key: "Status", width: 22 },
    { header: "Count", key: "Count", width: 12 },
    { header: "Percentage", key: "Percentage", width: 14 },
  ];
  implementationSheet.getRow(1).font = { bold: true };
  implementationSheet.addRows(report.implementationRows);

  const typeSheet = workbook.addWorksheet("Observation Breakdown");
  typeSheet.columns = [
    { header: "Observation Type", key: "Observation Type", width: 20 },
    { header: "Count", key: "Count", width: 12 },
  ];
  typeSheet.getRow(1).font = { bold: true };
  typeSheet.addRows(report.typeRows);

  const extraSheets: ExcelJS.Worksheet[] = [];
  if (!scope.school) {
    const schoolSheet = workbook.addWorksheet("School Breakdown");
    schoolSheet.columns = [
      { header: "School", key: "School", width: 28 },
      { header: "Total Observations", key: "Total Observations", width: 18 },
      { header: "Student Observations", key: "Student Observations", width: 20 },
      { header: "Classroom Observations", key: "Classroom Observations", width: 22 },
      { header: "Average Duration", key: "Average Duration", width: 18 },
    ];
    schoolSheet.getRow(1).font = { bold: true };
    schoolSheet.addRows(report.schoolRows);
    extraSheets.push(schoolSheet);
  }

  const teacherSheet = workbook.addWorksheet("Teacher Totals");
  teacherSheet.columns = [
    { header: "Teacher", key: "Teacher", width: 28 },
    { header: "Observations", key: "Observations", width: 16 },
  ];
  teacherSheet.getRow(1).font = { bold: true };
  teacherSheet.addRows(report.teacherRows);
  extraSheets.push(teacherSheet);

  if (scope.school) {
    const studentSheet = workbook.addWorksheet("Student Totals");
    studentSheet.columns = [
      { header: "Student", key: "Student", width: 28 },
      { header: "Observations", key: "Observations", width: 16 },
    ];
    studentSheet.getRow(1).font = { bold: true };
    studentSheet.addRows(report.studentRows);
    extraSheets.push(studentSheet);
  }

  const observationSheet = workbook.addWorksheet("Observations");
  observationSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Student", key: "student", width: 20 },
    { header: "Teacher", key: "teacher", width: 20 },
    { header: "School", key: "school", width: 24 },
    { header: "District", key: "district", width: 26 },
    { header: "Behavior", key: "behavior", width: 24 },
    { header: "Frequency", key: "frequency", width: 12 },
    { header: "Duration", key: "duration", width: 12 },
    { header: "Average Intensity", key: "averageIntensity", width: 18 },
    { header: "Highest Intensity", key: "highestIntensity", width: 18 },
    { header: "Implementation Status", key: "implementationStatus", width: 22 },
    { header: "Notes", key: "notes", width: 32 },
    { header: "Recommendations", key: "recommendations", width: 32 },
  ];
  observationSheet.getRow(1).font = { bold: true };
  observationSheet.addRows(report.observationRows.map((row) => ({
    date: row.Date,
    student: row.Student,
    teacher: row.Teacher,
    school: row.School,
    district: row.District,
    behavior: row.Behavior,
    frequency: row.Frequency,
    duration: row.Duration,
    averageIntensity: row["Average Intensity"],
    highestIntensity: row["Highest Intensity"],
    implementationStatus: row["Implementation Status"],
    notes: row.Notes,
    recommendations: row.Recommendations,
  })));

  [summary, behaviorSheet, implementationSheet, typeSheet, ...extraSheets, observationSheet].forEach(addAutoFit);

  const arrayBuffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const buffer = Buffer.from(arrayBuffer);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filenamePrefix}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const student = searchParams.get("student");
  const teacher = searchParams.get("teacher");
  const school = searchParams.get("school");
  const district = searchParams.get("district");
  const format = (searchParams.get("format") || "xlsx").trim().toLowerCase();
  const dateRange = getDateRangeFromParams(searchParams);
  const dateRangeLabel = getDateRangeLabelFromParams(searchParams);

  let rows: ObservationRow[] = [];
  let supportsObservationType = true;
  try {
    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user?.id) {
      return NextResponse.json({ ok: false, error: "Invalid authentication." }, { status: 401 });
    }

    const canManageAllObservations = isObservationAdmin(user);

    if (district && !student && !teacher) {
      return buildOrganizationalExport(
        supabase,
        { district, school: school || undefined, dateRangeLabel },
        format,
        dateRange,
        user.id,
        canManageAllObservations
      );
    }

    const selectWithType =
      "id, student_name, teacher_name, school, district, behavior, duration, created_at, observation_type";
    const selectWithoutType = "id, student_name, teacher_name, school, district, behavior, duration, created_at";

    const buildQuery = (select: string) => {
      let q = supabase
        .from("observations")
        .select(select)
        .order("created_at", { ascending: false })
        .limit(10000);

      if (!canManageAllObservations) q = q.eq("created_by", user.id);
      if (student) q = q.eq("student_name", student);
      if (teacher) q = q.eq("teacher_name", teacher);
      if (school) q = q.eq("school", school);
      if (district) q = q.eq("district", district);

      return q;
    };

    let { data, error } = await buildQuery(selectWithType);
    if (error && /observation_type/i.test(error.message || "")) {
      supportsObservationType = false;
      // Fall back for schemas that don't yet include observation_type.
      ({ data, error } = await buildQuery(selectWithoutType));
    }

    if (error) {
      console.error("Supabase reports query error:", error);
      return NextResponse.json({ ok: false, error: "Failed to fetch observations." }, { status: 500 });
    }

    rows = (Array.isArray(data) ? data : []) as unknown as ObservationRow[];
  } catch (e) {
    console.error("Reports route error:", e);
    return NextResponse.json({ ok: false, error: "Server misconfiguration." }, { status: 500 });
  }

  // Reporting rule: FBA data is excluded from aggregated (school/district/teacher) reports.
  // Only allow FBA results when the report is filtered by student *only*.
  const includeFba = Boolean(student) && !teacher && !school && !district;
  if (supportsObservationType && !includeFba) {
    rows = rows.filter((r) => {
      const t = (r.observation_type ?? r.type ?? "").toString().trim().toLowerCase();
      return t !== "fba";
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "InMind Observer";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Observations");
  worksheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Student", key: "student", width: 20 },
    { header: "Teacher", key: "teacher", width: 20 },
    { header: "School", key: "school", width: 24 },
    { header: "District", key: "district", width: 26 },
    { header: "Behavior", key: "behavior", width: 24 },
    { header: "Duration", key: "duration", width: 12 },
  ];

  worksheet.getRow(1).font = { bold: true };

  for (const o of rows) {
    const dateValue = o.created_at ? new Date(o.created_at) : null;
    worksheet.addRow({
      date: dateValue ? dateValue.toLocaleDateString("en-US") : "",
      student: o.student_name ?? "",
      teacher: o.teacher_name ?? "",
      school: o.school ?? "",
      district: o.district ?? "",
      behavior: o.behavior ?? "",
      duration: durationToString(o.duration),
    });
  }

  addAutoFit(worksheet);

  const arrayBuffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const buffer = Buffer.from(arrayBuffer);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="observations-report.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
