import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

type ObservationRow = {
  id: string;
  student_name: string | null;
  teacher_name: string | null;
  school: string | null;
  district: string | null;
  behavior: string | null;
  duration: number | string | null;
  created_at: string | null;
};

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function durationToString(value: ObservationRow["duration"]) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return `${value} min`;
  const s = String(value).trim();
  return s ? s : "";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const student = searchParams.get("student");
  const teacher = searchParams.get("teacher");
  const school = searchParams.get("school");
  const district = searchParams.get("district");

  let rows: ObservationRow[] = [];
  try {
    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = supabase
      .from("observations")
      .select("id, student_name, teacher_name, school, district, behavior, duration, created_at")
      .order("created_at", { ascending: false })
      .limit(10000);

    if (student) query = query.eq("student_name", student);
    if (teacher) query = query.eq("teacher_name", teacher);
    if (school) query = query.eq("school", school);
    if (district) query = query.eq("district", district);

    const { data, error } = await query;
    if (error) {
      console.error("Supabase reports query error:", error);
      return NextResponse.json({ ok: false, error: "Failed to fetch observations." }, { status: 500 });
    }

    rows = (data || []) as ObservationRow[];
  } catch (e) {
    console.error("Reports route error:", e);
    return NextResponse.json({ ok: false, error: "Server misconfiguration." }, { status: 500 });
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

  // Auto-fit columns (simple heuristic).
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
