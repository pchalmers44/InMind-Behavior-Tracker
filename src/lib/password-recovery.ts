import type { Session, SupabaseClient } from "@supabase/supabase-js";

export type RecoverySnapshot = {
  status: "idle" | "pending" | "ready" | "invalid" | "complete";
  userId: string | null;
};
const idle: RecoverySnapshot = { status: "idle", userId: null };

export function recoveryRedirect(origin: string) {
  const url = new URL("/change-password?recovery=1", origin);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid application origin");
  return url.href;
}

// Memory only. Never persist or publish callback URLs, tokens, or passwords.
export function createPasswordRecovery(client: SupabaseClient, href?: string) {
  let snapshot = idle;
  let proof: Session | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (status: RecoverySnapshot["status"], session: Session | null = null) => {
    if (disposed) return;
    if (status !== "pending") clearTimeout(timer);
    proof = session;
    snapshot = { status, userId: session?.user.id ?? null };
    listeners.forEach((listener) => listener());
  };
  if (href) {
    const url = new URL(href);
    const params = new URLSearchParams(url.hash.slice(1));
    const attempt = url.searchParams.get("recovery") === "1" || params.get("type") === "recovery" ||
      url.searchParams.get("type") === "recovery" || (url.pathname === "/change-password" &&
        (url.searchParams.has("code") || url.searchParams.has("token_hash") ||
         params.has("access_token") || params.has("error_description")));
    if (attempt) {
      const tokens = params.get("type") === "recovery" && params.has("access_token") &&
        params.has("refresh_token") && params.has("expires_in") && params.has("token_type");
      snapshot = { status: tokens && !params.has("error") && !params.has("error_description") &&
        !params.has("error_code") ? "pending" : "invalid", userId: null };
    }
  }
  // Registered synchronously immediately after client construction, before React mounts.
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session && snapshot.status !== "complete") publish("ready", session);
    else if (event === "TOKEN_REFRESHED" && snapshot.status === "ready") {
      if (session?.user.id === proof?.user.id) publish("ready", session);
      else publish("invalid");
    } else if ((event === "SIGNED_OUT" || event === "SIGNED_IN") && snapshot.status === "ready") publish("invalid");
  });
  if (snapshot.status === "pending") {
    // SDK initialization reports expired/invalid callback errors independently of getSession().
    // Its recovery event is queued before this check, so allow that event to arrive first.
    timer = setTimeout(() => {
      if (snapshot.status === "pending") publish("invalid");
    }, 20_000);
    void client.auth.initialize().then(() => {
      setTimeout(() => {
        clearTimeout(timer);
        if (snapshot.status === "pending") publish("invalid");
      }, 0);
    }, () => {
      clearTimeout(timer);
      if (snapshot.status === "pending") publish("invalid");
    });
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => idle,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isAttempt: () => snapshot.status !== "idle",
    isAuthorized: (session: Session | null) => snapshot.status === "ready" && Boolean(session && proof &&
      session.user.id === proof.user.id && session.access_token === proof.access_token &&
      session.expires_at && session.expires_at * 1000 > Date.now()),
    reset: () => publish("idle"),
    finish: () => publish("complete"),
    dispose: () => { disposed = true; clearTimeout(timer); subscription.unsubscribe(); },
  };
}
