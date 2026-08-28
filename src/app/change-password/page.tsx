"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const isRecovery = searchParams.get("recovery") === "1";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const email = user?.email ?? "";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email) {
      setError("No authenticated user email was found.");
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

    setIsSubmitting(true);

    if (!isRecovery) {
      const { error: currentPasswordError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (currentPasswordError) {
        setError(currentPasswordError.message);
        setIsSubmitting(false);
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    setMessage("Password updated successfully.");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsSubmitting(false);
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
        </form>
      </div>
    </main>
  );
}
