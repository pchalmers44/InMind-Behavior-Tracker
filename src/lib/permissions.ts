import type { User } from "@supabase/supabase-js";

type AppMetadata = Record<string, unknown>;

export function isObservationAdmin(user: Pick<User, "app_metadata"> | null | undefined) {
  const metadata = (user?.app_metadata || {}) as AppMetadata;
  const role = typeof metadata.role === "string" ? metadata.role.trim().toLowerCase() : "";
  const isAdmin = metadata.is_admin;

  return role === "admin" || role === "super_admin" || isAdmin === true || isAdmin === "true";
}
