import type { SupabaseClient } from "@supabase/supabase-js";

type Failure = { code?: string; status?: number; name?: string };

export function invalidSession(error: unknown) {
  const failure = (error || {}) as Failure;
  return failure.status === 401 || [
    "session_not_found", "session_expired", "refresh_token_not_found",
    "refresh_token_already_used", "bad_jwt", "user_not_found", "user_banned",
  ].includes(failure.code || "");
}

// Deliberately exclude messages, payloads, identifiers, and error details.
export function logDiagnostic(operation: string, error: unknown) {
  const failure = (error || {}) as Failure;
  const code = typeof failure.code === "string" && /^[A-Z0-9_]{1,40}$/i.test(failure.code)
    ? failure.code : undefined;
  const category = invalidSession(error) ? "authentication"
    : failure.name === "TimeoutError" || failure.name === "TypeError" || failure.status === 0 ? "network"
    : code && /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(code) ? "database"
    : failure.status && failure.status >= 500 ? "service" : "application";
  const status = typeof failure.status === "number" && Number.isFinite(failure.status) ? failure.status : undefined;
  console.warn("[reliability]", { operation, category, code, status });
}

export async function withDeadline<T>(work: PromiseLike<T>, abort?: () => void, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort?.();
          reject(Object.assign(new Error("Request timed out"), { name: "TimeoutError" }));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function safeSubjectName(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type PendingVisitWrite = {
  id: string;
  userId: string;
  editing: boolean;
  payload: Record<string, unknown>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function matchesWrite(row: unknown, write: PendingVisitWrite) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const saved = row as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(saved, "id") && saved.id === write.id && Object.entries(write.payload).every(([key, value]) => {
    // visits_set_updated_at replaces the client timestamp with database now().
    // It is bookkeeping, not submitted observation information.
    if (write.editing && key === "updated_at") return true;
    return value !== undefined && Object.prototype.hasOwnProperty.call(saved, key) &&
      JSON.stringify(canonical(saved[key])) === JSON.stringify(canonical(value));
  });
}

export async function reconcileVisit(client: SupabaseClient, write: PendingVisitWrite, admin: boolean) {
  const controller = new AbortController();
  let query = client.from("visits").select("*").eq("id", write.id);
  if (!admin) query = query.eq("created_by", write.userId);
  const result = await withDeadline(query.abortSignal(controller.signal), () => controller.abort());
  if (result.error) throw Object.assign(new Error("Verification unavailable"), {
    code: result.error.code, status: result.status,
  });
  return result.data?.length === 1 && matchesWrite(result.data[0], write);
}

export async function writeVisit(client: SupabaseClient, write: PendingVisitWrite, admin: boolean) {
  const controller = new AbortController();
  let query = write.editing
    ? client.from("visits").update(write.payload).eq("id", write.id)
    : client.from("visits").insert([{ id: write.id, created_by: write.userId, ...write.payload }]);
  if (write.editing && !admin) query = query.eq("created_by", write.userId);
  return withDeadline(query.select().abortSignal(controller.signal), () => controller.abort());
}

export function ambiguousWrite(status: number, code?: string) {
  return !status || status >= 500 || status === 408 || code === "23505";
}

export function missingColumn(code?: string) {
  return code === "PGRST204" || code === "42703";
}
