"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { passwordRecovery, passwordUpdates, supabase } from "@/lib/supabase";
import { logDiagnostic, withDeadline } from "@/lib/reliability";
import { useAuth } from "@/components/auth/AuthProvider";

export default function ChangePasswordPage() {
  const { user, session, recovery, retryVerification } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantsRecovery = searchParams.get("recovery") === "1" || recovery.status !== "idle";
  const isRecovery = wantsRecovery && passwordRecovery.isAuthorized(session) && user?.id === recovery.userId;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const [completed, setCompleted] = useState(false);

  const email = user?.email ?? "";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    setMessage("");
    if (wantsRecovery && !isRecovery) {
      setError("This recovery link is not verified. Request a new link from Forgot Password.");
      return;
    }
    if (!email || !user || !session) {
      setError("Verify your session before changing your password.");
      return;
    }
    if ((!isRecovery && !currentPassword) || !newPassword || !confirmPassword) {
      setError("Complete all password fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (!isRecovery && newPassword === currentPassword) {
      setError("Choose a new password that is different from your current password.");
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    let changed = false;
    try {
      const intendedUserId = user.id;
      if (!isRecovery) {
        const signedIn = await withDeadline(supabase.auth.signInWithPassword({ email, password: currentPassword }));
        if (signedIn.error) {
          setError("The current password could not be verified. Check it and try again.");
          return;
        }
        if (signedIn.data.user?.id !== intendedUserId) throw new Error("Account changed during verification");
      }
      const current = await withDeadline(supabase.auth.getSession());
      if (current.error) throw current.error;
      const currentSession = current.data.session;
      if (!currentSession || currentSession.user.id !== intendedUserId ||
          (isRecovery && !passwordRecovery.isAuthorized(currentSession))) {
        throw Object.assign(new Error("Session changed"), { name: "PasswordSessionError" });
      }
      const verified = await withDeadline(supabase.auth.getUser(currentSession.access_token));
      if (verified.error) throw verified.error;
      if (verified.data.user?.id !== intendedUserId) throw new Error("Account verification failed");
      const result = await passwordUpdates.run(currentSession, () => supabase.auth.updateUser({ password: newPassword }));
      if (result.error) {
        logDiagnostic("password-update", result.error);
        setError(["weak_password", "same_password"].includes(result.error.code || "")
          ? result.error.message
          : result.error.status === 429 ? "Please wait before trying another password update."
          : "The password could not be updated. Check your session, try again, or request a new recovery link.");
        return;
      }
      if (result.data.user?.id !== intendedUserId) throw new Error("Password update could not be confirmed");
      changed = true;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated successfully.");
      if (isRecovery) {
        setCompleted(true);
        passwordRecovery.finish();
        try {
          const signedOut = await withDeadline(supabase.auth.signOut({ scope: "local" }));
          if (signedOut.error) throw signedOut.error;
        } catch (failure) {
          logDiagnostic("password-recovery-signout", failure);
        }
        router.replace("/login");
      }
    } catch (failure) {
      logDiagnostic("password-update", failure);
      setError(changed ? "Your password was updated. Continue to Sign In."
        : failure instanceof Error && failure.name === "PasswordSessionError"
          ? "Your session changed. Sign in again or request a new recovery link before updating your password."
          : "The password update could not be confirmed. Check your connection. Try signing in with your new password before requesting another recovery link.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  if (completed || recovery.status === "complete") {
    return <main style={{ padding: 32 }}><p role="status">Password updated successfully. Sign in with your new password.</p><Link href="/login">Continue to Sign In</Link></main>;
  }
  if (wantsRecovery && !isRecovery) {
    const verifying = recovery.status === "pending" || recovery.status === "ready";
    return <main style={{ padding: 32 }}><p role="status">{verifying
      ? "Verifying your recovery session. If this does not complete, retry verification or request a new link."
      : "This recovery link is expired, invalid, or could not be verified. Request a new link using Forgot Password."}</p>
      {verifying && <button type="button" onClick={retryVerification}>Retry session verification</button>}
      <p><Link href="/login">Request a new recovery link or sign in</Link></p></main>;
  }

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
          maxWidth: 460,
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 24px 80px rgba(2, 6, 23, 0.45)",
        }}
      >
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#38bdf8" }}>
            ACCOUNT
          </div>
          <h1 style={{ margin: "8px 0 6px", fontSize: 28, lineHeight: 1.1, color: "#f8fafc" }}>Change password</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#94a3b8" }}>
            Signed in as {email || "your account"}.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <fieldset disabled={isSubmitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {!isRecovery ? (
            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor="current-password"
                style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}
              >
                CURRENT PASSWORD
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
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
          ) : null}

          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="new-password"
              style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}
            >
              NEW PASSWORD
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
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

          <div style={{ marginBottom: 18 }}>
            <label
              htmlFor="confirm-password"
              style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}
            >
              CONFIRM NEW PASSWORD
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
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

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                flex: 1,
                minWidth: 180,
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
              {isSubmitting ? "Updating..." : "Update Password"}
            </button>

            <Link
              href="/"
              style={{
                flex: 1,
                minWidth: 180,
                borderRadius: 12,
                padding: "14px 16px",
                fontSize: 15,
                fontWeight: 800,
                color: "#e2e8f0",
                background: "#111827",
                border: "1px solid #334155",
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Back to app
            </Link>
          </div>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
