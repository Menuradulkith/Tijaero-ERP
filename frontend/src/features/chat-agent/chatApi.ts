/** Chat Agent — REST calls (non-streaming) via the shared axios client. */
import apiClient from "@/api/client";
import type {
  ActionResolveResponse,
  ConversationDetail,
  ConversationSummary,
} from "./types";

export const chatAgentApi = {
  listConversations: async () => {
    const res = await apiClient.get<ConversationSummary[]>("/chat-agent/conversations");
    return res.data;
  },

  getConversation: async (id: number) => {
    const res = await apiClient.get<ConversationDetail>(
      `/chat-agent/conversations/${id}`,
      { headers: { "X-Hide-Error-Toast": "1" } },
    );
    return res.data;
  },

  archiveConversation: async (id: number) => {
    await apiClient.delete(`/chat-agent/conversations/${id}`);
  },

  approveAction: async (actionId: number) => {
    const res = await apiClient.post<ActionResolveResponse>(
      `/chat-agent/actions/${actionId}/approve`,
      undefined,
      { headers: { "X-Hide-Error-Toast": "1" } },
    );
    return res.data;
  },

  rejectAction: async (actionId: number) => {
    const res = await apiClient.post<ActionResolveResponse>(
      `/chat-agent/actions/${actionId}/reject`,
      undefined,
      { headers: { "X-Hide-Error-Toast": "1" } },
    );
    return res.data;
  },
};
