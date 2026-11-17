import type { Session } from "@supabase/supabase-js";
import { withDeadline } from "./reliability";

// Bind SDK password writes to the session checked by the form, including queued writes.
export function createPasswordUpdates(supabaseUrl: string) {
  const endpoint = new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`);
  let active: { token: string; controller: AbortController } | null = null;
  const guardedFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === endpoint.origin && url.pathname === endpoint.pathname && init?.method?.toUpperCase() === "PUT") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
      if (body && Object.prototype.hasOwnProperty.call(body, "password")) {
        const authorization = new Headers(init.headers).get("Authorization");
        if (!active || active.controller.signal.aborted || authorization !== `Bearer ${active.token}`) {
          return Promise.reject(Object.assign(new Error("Session changed before password update"), { name: "PasswordSessionError" }));
        }
        return fetch(input, { ...init, signal: active.controller.signal });
      }
    }
    return fetch(input, init);
  };
  return {
    fetch: guardedFetch,
    async run<T>(session: Session, update: () => Promise<T>): Promise<T> {
      if (active) throw Object.assign(new Error("Previous password update is still finishing"), { name: "PasswordPendingError" });
      const operation = { token: session.access_token, controller: new AbortController() };
      active = operation;
      let work: Promise<T>;
      try { work = update(); }
      catch (error) { active = null; throw error; }
      const release = () => { if (active === operation) active = null; };
      // Keep timed-out SDK calls guarded until they settle; they must never send a late write.
      void work.then(release, release);
      return withDeadline(work, () => operation.controller.abort());
    },
  };
}
