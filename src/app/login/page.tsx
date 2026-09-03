"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (sessionError) {
        setError(sessionError.message);
        return;
      }
      if (data.session) {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (!isMounted) return;
        if (userError || !userData.user) {
          if (isSubmittingRef.current) return;
          await supabase.auth.signOut({ scope: "local" });
          return;
        }
        router.replace("/");
      }
    };

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/change-password?recovery=1");
        return;
      }
      if (session) {
        void (async () => {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData.user) {
            if (isSubmittingRef.current) return;
            await supabase.auth.signOut({ scope: "local" });
            return;
          }
          router.replace("/");
        })();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    setMessage("");

    await supabase.auth.signOut({ scope: "local" });

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      isSubmittingRef.current = false;
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }

    if (!data.session) {
      isSubmittingRef.current = false;
      setError("Sign in succeeded, but no session was returned. Please try again.");
      setIsSubmitting(false);
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      isSubmittingRef.current = false;
      setError(userError?.message || "Sign in succeeded, but the user profile could not be loaded. Please try again.");
      setIsSubmitting(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email first so we can send a reset link.");
      setMessage("");
      return;
    }

    setIsResetting(true);
    setError("");
    setMessage("");

    const origin =
      typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL ?? "";

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: origin ? `${origin}/change-password?recovery=1` : undefined,
    });

    if (resetError) {
      setError(resetError.message);
      setIsResetting(false);
      return;
    }

    setMessage("Password reset email sent. Check your inbox for the recovery link.");
    setIsResetting(false);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 24px 80px rgba(2, 6, 23, 0.45)",
        }}
      >
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#38bdf8" }}>
            INMIND
          </div>
          <h1 style={{ margin: "8px 0 6px", fontSize: 28, lineHeight: 1.1, color: "#f8fafc" }}>Sign in</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#94a3b8" }}>
            Use your Supabase email and password to access the app.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="email"
              style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}
            >
              EMAIL
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 10,
                color: "#e2e8f0",
                padding: "12px 14px",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label
              htmlFor="password"
              style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}
            >
              PASSWORD
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 10,
                color: "#e2e8f0",
                padding: "12px 14px",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={isResetting || isSubmitting}
              style={{
                background: "none",
                border: "none",
                color: "#38bdf8",
                cursor: isResetting || isSubmitting ? "not-allowed" : "pointer",
                fontSize: 13,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {isResetting ? "Sending reset link..." : "Forgot Password?"}
            </button>
          </div>

          {error && (
            <div
              style={{
                marginBottom: 14,
                borderRadius: 10,
                border: "1px solid #7f1d1d",
                background: "#450a0a",
                color: "#fecaca",
                padding: "10px 12px",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {message && (
            <div
              style={{
                marginBottom: 14,
                borderRadius: 10,
                border: "1px solid #14532d",
                background: "#052e16",
                color: "#bbf7d0",
                padding: "10px 12px",
                fontSize: 13,
              }}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              border: "none",
              borderRadius: 12,
              padding: "14px 16px",
              fontSize: 15,
              fontWeight: 800,
              color: "#0f172a",
              background: isSubmitting ? "#94a3b8" : "linear-gradient(135deg, #38bdf8, #818cf8)",
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Signing In..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          <Link href="/" style={{ color: "#cbd5e1", textDecoration: "none" }}>
            Return to home
          </Link>
        </div>
      </div>
    </main>
  );
}
