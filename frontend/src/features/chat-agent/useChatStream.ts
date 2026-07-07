/**
 * Chat Agent — fetch-based streaming hook.
 *
 * Axios cannot stream in browsers, so the chat endpoint is consumed with
 * fetch + ReadableStream. The Authorization header is injected from the same
 * zustand auth store the axios client uses (no EventSource / query tokens).
 */
import { useCallback, useRef, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import type { StreamEvent } from "./types";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:8000/api/v1";

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void;
  onFinish?: () => void;
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (
      message: string,
      conversationId: number | null,
      handlers: StreamHandlers,
    ) => {
      const token = useAuthStore.getState().token;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      try {
        const res = await fetch(`${API_BASE}/chat-agent/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({
            conversation_id: conversationId,
            message,
          }),
          signal: controller.signal,
        });

        if (res.status === 401) {
          handlers.onEvent({
            type: "error",
            message: "Session expired — please refresh the page and try again.",
          });
          return;
        }
        if (res.status === 403) {
          handlers.onEvent({
            type: "error",
            message: "You don't have permission to use the AI assistant.",
          });
          return;
        }
        if (!res.ok || !res.body) {
          handlers.onEvent({
            type: "error",
            message: `Assistant request failed (HTTP ${res.status}).`,
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // SSE-style framing: "data: {...}\n\n"
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!frame.startsWith("data:")) continue;
            const raw = frame.slice(5).trim();
            if (!raw) continue;
            try {
              handlers.onEvent(JSON.parse(raw) as StreamEvent);
            } catch {
              // ignore malformed frame
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          handlers.onEvent({
            type: "error",
            message: "Connection lost while streaming the reply.",
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        handlers.onFinish?.();
      }
    },
    [],
  );

  return { send, stop, isStreaming };
}
