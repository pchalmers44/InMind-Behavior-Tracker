"use client";

import { useCallback, useEffect, useState } from "react";

type VersionResponse = {
  version?: string;
};

type AppUpdateNotificationProps = {
  currentVersion: string;
};

const CHECK_INTERVAL_MS = 60_000;
const OBSERVATION_ACTIVE_EVENT = "inmind:observation-active";

export function AppUpdateNotification({ currentVersion }: AppUpdateNotificationProps) {
  const [isObservationActive, setIsObservationActive] = useState(false);
  const [hasPendingUpdate, setHasPendingUpdate] = useState(false);
  const [isDismissedForVersion, setIsDismissedForVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!currentVersion || currentVersion === "development") return;

    try {
      const response = await fetch(`/api/version?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) return;

      const payload = (await response.json()) as VersionResponse;
      const latestVersion = payload.version;
      if (!latestVersion || latestVersion === "development" || latestVersion === currentVersion) return;

      setLatestVersion(latestVersion);
      setHasPendingUpdate(true);
      setIsDismissedForVersion((dismissedVersion) =>
        dismissedVersion && dismissedVersion !== latestVersion ? null : dismissedVersion
      );
    } catch {
      // Update checks are best-effort and should never affect observations.
    }
  }, [currentVersion]);

  useEffect(() => {
    const initialCheckId = window.setTimeout(() => {
      void checkForUpdate();
    }, 0);

    const intervalId = window.setInterval(() => {
      void checkForUpdate();
    }, CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    const handleFocus = () => {
      void checkForUpdate();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearTimeout(initialCheckId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkForUpdate]);

  useEffect(() => {
    const handleObservationActiveChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      setIsObservationActive(Boolean(customEvent.detail?.active));
    };

    window.addEventListener(OBSERVATION_ACTIVE_EVENT, handleObservationActiveChange);
    return () => {
      window.removeEventListener(OBSERVATION_ACTIVE_EVENT, handleObservationActiveChange);
    };
  }, []);

  const isDocumentMarkedActive =
    typeof document !== "undefined" && document.documentElement.dataset.inmindObservationActive === "true";
  const shouldShow =
    hasPendingUpdate && !isObservationActive && !isDocumentMarkedActive && latestVersion !== isDismissedForVersion;

  if (!shouldShow) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "#0f172a",
          color: "#e2e8f0",
          border: "1px solid #334155",
          borderRadius: 12,
          boxShadow: "0 18px 45px rgba(2, 6, 23, 0.42)",
          padding: "12px 14px",
          pointerEvents: "auto",
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        }}
      >
        <div style={{ fontSize: 14, lineHeight: 1.35, fontWeight: 700 }}>
          A new version of InMind Observations is available. Refresh to update.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              if (latestVersion) setIsDismissedForVersion(latestVersion);
            }}
            aria-label="Dismiss update notification"
            style={{
              background: "transparent",
              color: "#94a3b8",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: "#38bdf8",
              color: "#0f172a",
              border: "none",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 13,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

export { OBSERVATION_ACTIVE_EVENT };
