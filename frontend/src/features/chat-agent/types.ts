/** Chat Agent — shared types for the assistant widget. */

export interface PendingAction {
  id: number;
  conversation_id: number;
  tool_name: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
  created_at?: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  month_spend_usd: number;
  monthly_budget_usd: number;
}

/** SSE frames emitted by POST /chat-agent/chat */
export type StreamEvent =
  | { type: "meta"; conversation_id: number; title: string }
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; is_write: boolean }
  | { type: "pending_action"; action: PendingAction }
  | { type: "navigate"; route: string; label: string }
  | { type: "done"; message_id: number; conversation_id: number; usage: ChatUsage }
  | { type: "error"; message: string };

/** A rendered entry in the chat transcript. */
export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "info";
  content: string;
  /** Names of tools invoked while producing this assistant message. */
  tools?: string[];
  /** Inline pending-action card. */
  action?: PendingAction;
  streaming?: boolean;
}

export interface ConversationSummary {
  id: number;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  tool_name?: string | null;
  created_at?: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  pending_actions: PendingAction[];
}

export interface ActionResolveResponse {
  id: number;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  summary: string;
}
