"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { invalidSession, logDiagnostic, withDeadline } from "@/lib/reliability";

type AuthContextValue = {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function AuthOverlay({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => Promise<void>;
}) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const changePasswordRef = useRef<HTMLButtonElement | null>(null);
  const logoutRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    changePasswordRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleLogout = async () => {
    setIsOpen(false);
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    router.push("/change-password");
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusables = [changePasswordRef.current, logoutRef.current].filter(Boolean) as HTMLElement[];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="account-menu"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        style={{
          width: 42,
          height: 42,
          borderRadius: 999,
          border: "1px solid rgba(51, 65, 85, 0.95)",
          background: "rgba(15, 23, 42, 0.92)",
          boxShadow: "0 12px 30px rgba(2, 6, 23, 0.32)",
          backdropFilter: "blur(10px)",
          color: "#e2e8f0",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          padding: 0,
        }}
        title={email}
      >
        <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 800 }}>
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          Open account menu
        </span>
      </button>

      {isOpen ? (
        <div
          id="account-menu"
          role="menu"
          aria-label="Account menu"
          onKeyDown={handleMenuKeyDown}
          style={{
            marginTop: 10,
            minWidth: 260,
            background: "rgba(15, 23, 42, 0.96)",
            border: "1px solid rgba(51, 65, 85, 0.95)",
            borderRadius: 16,
            padding: 12,
            boxShadow: "0 18px 40px rgba(2, 6, 23, 0.42)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ padding: "4px 4px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Signed in as:</div>
            <div
              style={{
                marginTop: 4,
                color: "#f8fafc",
                fontSize: 14,
                fontWeight: 800,
                wordBreak: "break-word",
              }}
            >
              {email}
            </div>
          </div>

          <div style={{ height: 1, background: "#334155", margin: "0 0 8px" }} />

          <button
            ref={changePasswordRef}
            type="button"
            role="menuitem"
            onClick={handleChangePassword}
            style={{
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              color: "#e2e8f0",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Change Password
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={isLoggingOut}
            ref={logoutRef}
            style={{
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              color: isLoggingOut ? "#64748b" : "#fca5a5",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              fontWeight: 700,
              cursor: isLoggingOut ? "not-allowed" : "pointer",
            }}
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [authError, setAuthError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const verified = useRef<{ session: Session; user: User } | null>(null);

  useEffect(() => {
    let mounted = true;
    let generation = 0;
    const scheduled = new Set<ReturnType<typeof setTimeout>>();
    const current = (ticket: number) => mounted && ticket === generation;

    const clearSession = () => {
      verified.current = null;
      setSessionExpired(true);
      setSession(null);
      setUser(null);
      setIsLoading(false);
      setAuthError("");
      if (!isLoginPage) router.replace("/login");
    };

    const verify = async (ticket: number, candidate?: Session | null) => {
      try {
        if (candidate === undefined) {
          const result = await withDeadline(supabase.auth.getSession());
          if (!current(ticket)) return;
          if (result.error) throw result.error;
          candidate = result.data.session;
        }
        if (!current(ticket)) return;
        if (!candidate) {
          clearSession();
          return;
        }
        if (verified.current && verified.current.user.id !== candidate.user.id) {
          verified.current = null;
          setSession(null);
          setUser(null);
        }
        // An explicit JWT avoids re-entering the SDK's session lock from auth events.
        const result = await withDeadline(supabase.auth.getUser(candidate.access_token));
        if (!current(ticket)) return;
        if (result.error) throw result.error;
        if (!result.data.user || result.data.user.id !== candidate.user.id ||
            !candidate.expires_at || candidate.expires_at * 1000 <= Date.now()) {
          throw new Error("Session verification incomplete");
        }
        verified.current = { session: candidate, user: result.data.user };
        setSessionExpired(false);
        setSession(candidate);
        setUser(result.data.user);
        setAuthError("");
        setIsLoading(false);
      } catch (error) {
        if (!current(ticket)) return;
        logDiagnostic("auth-verification", error);
        if (invalidSession(error)) {
          clearSession();
          // State is already blocked even if local SDK cleanup fails or stalls.
          void withDeadline(supabase.auth.signOut({ scope: "local" })).catch((cleanupError) => {
            logDiagnostic("auth-local-cleanup", cleanupError);
          });
          return;
        }
        setIsLoading(false);
        setAuthError("Unable to verify your session. Check your connection and retry. Your open observation is kept in this tab.");
      }
    };

    setIsLoading(!verified.current);
    setAuthError("");
    void verify(++generation);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const ticket = ++generation;
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        clearSession();
        return;
      }
      const timer = setTimeout(() => {
        scheduled.delete(timer);
        // INITIAL_SESSION can be null when the SDK's session read fails.
        // Re-read it to distinguish a temporary failure from a missing session.
        if (current(ticket)) void verify(ticket, nextSession ?? undefined);
      }, 0);
      scheduled.add(timer);
    });
    return () => {
      mounted = false;
      generation++;
      scheduled.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [isLoginPage, router, retryKey]);

  useEffect(() => {
    if (!session?.expires_at) return;
    const timer = setTimeout(() => {
      setSessionExpired(true);
      setRetryKey((key) => key + 1);
    }, Math.max(0, session.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  const accessReady = Boolean(session && user && !sessionExpired);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session: accessReady ? session : null,
      user: accessReady ? user : null,
      logout,
    }),
    [accessReady, isLoading, logout, session, user]
  );

  const recovery = (
    <div role="status" style={{ padding: 20, background: "#0f172a", color: "#e2e8f0" }}>
      <p>{authError || "Verifying your session..."}</p>
      <button type="button" onClick={() => setRetryKey((key) => key + 1)}>Retry session verification</button>
    </div>
  );

  return (
    <AuthContext.Provider value={value}>
      {((!isLoginPage && !accessReady) || authError) ? recovery : null}
      {!isLoginPage && accessReady && session?.user?.email ? (
        <AuthOverlay email={session.user.email} onLogout={logout} />
      ) : null}
      {isLoginPage ? children : user ? (
        // Keep verified editors mounted while access is blocked during transient recovery.
        <div hidden={!accessReady} inert={!accessReady}>{children}</div>
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
