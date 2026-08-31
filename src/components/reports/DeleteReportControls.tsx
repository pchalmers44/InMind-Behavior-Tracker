"use client";

import type { CSSProperties } from "react";

export type ReportToast = { type: "success" | "error"; message: string } | null;

export function TrashButton({
  onClick,
  className,
  style,
  disabled = false,
}: {
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Delete report"
      title="Delete report"
      className={className}
      style={style}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 6l1 15h10l1-15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function DeleteReportDialog({
  isDeleting,
  onCancel,
  onConfirm,
}: {
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-report-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(2, 6, 23, 0.78)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(100%, 420px)",
          border: "1px solid #334155",
          borderRadius: 16,
          background: "#0f172a",
          boxShadow: "0 20px 60px rgba(2, 6, 23, 0.5)",
          padding: 20,
        }}
      >
        <h2 id="delete-report-title" style={{ margin: 0, color: "#f8fafc", fontSize: 20, fontWeight: 900 }}>
          Delete Report?
        </h2>
        <p style={{ margin: "10px 0 0", color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>
          This action cannot be undone.
          <br />
          Are you sure you want to permanently delete this observation?
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            style={{
              border: "1px solid #334155",
              borderRadius: 10,
              background: "#111827",
              color: "#e2e8f0",
              cursor: isDeleting ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 800,
              padding: "9px 14px",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            style={{
              border: "none",
              borderRadius: 10,
              background: isDeleting ? "#7f1d1d" : "#ef4444",
              color: "#fff",
              cursor: isDeleting ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 900,
              padding: "9px 14px",
            }}
          >
            Delete Report
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReportToastMessage({ toast }: { toast: ReportToast }) {
  if (!toast) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 210,
        maxWidth: 360,
        border: `1px solid ${toast.type === "success" ? "#166534" : "#7f1d1d"}`,
        borderRadius: 12,
        background: toast.type === "success" ? "#052e16" : "#450a0a",
        color: toast.type === "success" ? "#bbf7d0" : "#fecaca",
        boxShadow: "0 16px 40px rgba(2, 6, 23, 0.4)",
        fontSize: 13,
        fontWeight: 800,
        padding: "10px 12px",
      }}
    >
      {toast.message}
    </div>
  );
}
