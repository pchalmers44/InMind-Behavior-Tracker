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

  useEffect(() => {
    let isMounted = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(data.session ?? null);
      setIsLoading(false);
      if (!data.session && !isLoginPage) {
        router.replace("/login");
      }
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession ?? null);
      setIsLoading(false);
      if (!nextSession && !isLoginPage) {
        router.replace("/login");
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [isLoginPage, router]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session,
      user: session?.user ?? null,
      logout,
    }),
    [isLoading, logout, session]
  );

  if (!isLoginPage && (isLoading || !session)) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a" }} />
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {!isLoginPage && session?.user?.email ? (
        <AuthOverlay email={session.user.email} onLogout={logout} />
      ) : null}
      {children}
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
