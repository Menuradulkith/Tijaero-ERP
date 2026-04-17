import { showWarningToast } from "@/components/tijaero";
import { useAuthStore } from "@/state/authStore";
import { useEffect, useRef } from "react";

const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const WARNING_BEFORE_LOGOUT_MS = 60_000;
const ACTIVITY_THROTTLE_MS = 1_000;

function getIdleTimeoutMs(): number {
  const raw = import.meta.env.VITE_IDLE_TIMEOUT_MINUTES;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed * 60_000;
  }
  return DEFAULT_IDLE_TIMEOUT_MINUTES * 60_000;
}

export default function IdleSessionManager() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const lastActivityAtRef = useRef<number>(Date.now());
  const warningShownRef = useRef<boolean>(false);
  const lastTrackedEventAtRef = useRef<number>(0);
  const warnedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const idleTimeoutMs = getIdleTimeoutMs();
    const warningThresholdMs = Math.max(
      idleTimeoutMs - WARNING_BEFORE_LOGOUT_MS,
      Math.floor(idleTimeoutMs * 0.8),
    );

    const markActivity = () => {
      const now = Date.now();
      if (now - lastTrackedEventAtRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastTrackedEventAtRef.current = now;
      lastActivityAtRef.current = now;
      warningShownRef.current = false;
      warnedAtRef.current = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markActivity();
      }
    };

    markActivity();

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
      "focus",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const idleForMs = now - lastActivityAtRef.current;

      if (!warningShownRef.current && idleForMs >= warningThresholdMs) {
        const warnedAgo = warnedAtRef.current ? now - warnedAtRef.current : Infinity;
        if (warnedAgo > 30_000) {
          warningShownRef.current = true;
          warnedAtRef.current = now;
          showWarningToast("You will be logged out soon due to inactivity.");
        }
      }

      if (idleForMs >= idleTimeoutMs) {
        logout();
        window.location.href = "/login";
      }
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isAuthenticated, logout]);

  return null;
}
