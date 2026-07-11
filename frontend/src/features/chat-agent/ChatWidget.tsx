/**
 * Tijaero Assistant — floating AI chat widget.
 *
 * Mounted once in MainLayout; visible only to users holding the
 * `ai_assistant:view` permission. Write actions proposed by the agent render
 * as inline confirmation cards and only execute after explicit approval.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import CloseIcon from "@mui/icons-material/Close";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import BuildCircleOutlinedIcon from "@mui/icons-material/BuildCircleOutlined";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";

import { usePermission } from "@/auth/permissions";
import { useFormGuardStore } from "@/state/formGuardStore";
import { TConfirmDialog, useConfirmDialog } from "@/components/tijaero";
import { chatAgentApi } from "./chatApi";
import { useChatStream } from "./useChatStream";
import { useChatAgentUi } from "./chatAgentStore";
import type { ChatEntry, ConversationMessage, PendingAction } from "./types";

let entrySeq = 0;
const nextId = () => `e${++entrySeq}`;

// ─── markdown bubble ────────────────────────────────────────────────────────

function Markdown({ text }: { text: string }) {
  return (
    <Box
      sx={{
        fontSize: 13.5,
        lineHeight: 1.55,
        wordBreak: "break-word",
        "& p": { m: 0, mb: 0.75 },
        "& p:last-child": { mb: 0 },
        "& ul, & ol": { m: 0, mb: 0.75, pl: 2.5 },
        "& code": {
          bgcolor: "action.hover",
          px: 0.5,
          borderRadius: 0.5,
          fontSize: 12.5,
        },
        "& pre": {
          bgcolor: "action.hover",
          p: 1,
          borderRadius: 1,
          overflowX: "auto",
        },
        "& table": {
          borderCollapse: "collapse",
          my: 0.75,
          fontSize: 12.5,
          width: "100%",
        },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 0.75,
          py: 0.35,
          textAlign: "left",
        },
        "& th": { bgcolor: "action.hover", fontWeight: 600 },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </Box>
  );
}

// ─── pending action confirmation card ───────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  create_supplier: "Create supplier",
  create_purchase_order: "Create purchase order",
  approve_purchase_order: "Approve/reject purchase order",
  update_stock_status: "Update stock status",
  update_company_asset_status: "Update company asset status",
  create_branch: "Create branch",
  create_customer: "Create customer",
  create_quotation: "Create quotation",
  record_customer_payment: "Record customer payment",
  approve_sales_order: "Approve/reject sales order",
  approve_sale_return: "Approve/reject sale return",
  return_invoice: "Return full invoice",
  create_expense: "Create expense",
  submit_expense: "Submit expense for approval",
  approve_expense: "Approve/reject expense",
  create_bank_deposit: "Create bank deposit",
  verify_bank_deposit: "Verify bank deposit",
  create_journal_entry: "Create journal entry",
  post_journal_entry: "Post journal entry",
  approve_journal_entry: "Approve/reject journal entry",
  resolve_approval: "Approve/reject request",
};

function ActionCard({
  action,
  onResolved,
}: {
  action: PendingAction;
  onResolved: (updated: PendingAction, summary: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const resolve = async (approve: boolean) => {
    setBusy(approve ? "approve" : "reject");
    try {
      const res = approve
        ? await chatAgentApi.approveAction(action.id)
        : await chatAgentApi.rejectAction(action.id);
      onResolved(
        { ...action, status: res.status as PendingAction["status"], result: res.result, error: res.error },
        res.summary || (approve ? "Action executed." : "Action rejected."),
      );
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Action failed.";
      onResolved({ ...action, status: "failed", error: detail }, detail);
    } finally {
      setBusy(null);
    }
  };

  const preview = action.preview || action.payload || {};
  const rows = Object.entries(preview).filter(
    ([k, v]) => k !== "action" && v !== null && v !== undefined && typeof v !== "object",
  );
  const items = Array.isArray((preview as Record<string, unknown>).items)
    ? ((preview as Record<string, unknown>).items as Record<string, unknown>[])
    : [];
  const warnings = Array.isArray((preview as Record<string, unknown>).warnings)
    ? ((preview as Record<string, unknown>).warnings as string[])
    : [];

  const isPending = action.status === "pending";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderColor: isPending ? "warning.main" : "divider",
        bgcolor: "background.paper",
        maxWidth: "100%",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <BuildCircleOutlinedIcon fontSize="small" color={isPending ? "warning" : "disabled"} />
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {(preview as Record<string, unknown>).action?.toString() ||
            TOOL_LABELS[action.tool_name] ||
            action.tool_name}
        </Typography>
        {action.status !== "pending" && (
          <Chip
            size="small"
            label={action.status}
            color={
              action.status === "executed"
                ? "success"
                : action.status === "failed"
                  ? "error"
                  : "default"
            }
          />
        )}
      </Stack>

      <Box sx={{ fontSize: 12.5, color: "text.secondary" }}>
        {rows.map(([k, v]) => (
          <Stack key={k} direction="row" spacing={0.75}>
            <Typography variant="caption" sx={{ minWidth: 110, fontWeight: 600 }}>
              {k.replace(/_/g, " ")}
            </Typography>
            <Typography variant="caption">{String(v)}</Typography>
          </Stack>
        ))}
        {items.length > 0 && (
          <Box sx={{ mt: 0.5 }}>
            {items.map((it, i) => (
              <Typography key={i} variant="caption" display="block">
                • {String(it.product ?? it.product_id)} — {String(it.quantity)} ×{" "}
                {Number(it.unit_price).toLocaleString()}
              </Typography>
            ))}
          </Box>
        )}
      </Box>

      {warnings.map((w, i) => (
        <Alert key={i} severity="warning" sx={{ mt: 0.75, py: 0, fontSize: 12 }}>
          {w}
        </Alert>
      ))}
      {action.error && (
        <Alert severity="error" sx={{ mt: 0.75, py: 0, fontSize: 12 }}>
          {action.error}
        </Alert>
      )}

      {isPending && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={
              busy === "approve" ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlineIcon />
            }
            disabled={busy !== null}
            onClick={() => resolve(true)}
          >
            Approve
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={
              busy === "reject" ? <CircularProgress size={14} color="inherit" /> : <HighlightOffIcon />
            }
            disabled={busy !== null}
            onClick={() => resolve(false)}
          >
            Reject
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

// ─── main widget ────────────────────────────────────────────────────────────

export default function ChatAgentWidget() {
  const canUse = usePermission("ai_assistant", "view");
  const navigate = useNavigate();
  const open = useChatAgentUi((s) => s.open);
  const setOpen = useChatAgentUi((s) => s.setOpen);
  const conversationId = useChatAgentUi((s) => s.conversationId);
  const setConversationId = useChatAgentUi((s) => s.setConversationId);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const { send, stop, isStreaming } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamEntryId = useRef<string | null>(null);
  const hydratedRef = useRef<number | null>(null);

  const isDirty = useFormGuardStore((s) => s.isDirty);
  const executeDiscard = useFormGuardStore((s) => s.executeDiscard);
  const discardDialog = useConfirmDialog();

  // Resume the persisted conversation's transcript the first time the widget
  // opens (or after a reload), so the visible history matches what the server
  // already remembers for this conversation.
  useEffect(() => {
    if (!open || conversationId == null) return;
    if (hydratedRef.current === conversationId || entries.length > 0) return;
    hydratedRef.current = conversationId;
    let cancelled = false;
    void chatAgentApi
      .getConversation(conversationId)
      .then((detail) => {
        if (cancelled) return;
        setEntries(
          detail.messages.map((m: ConversationMessage) => ({
            id: nextId(),
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        );
      })
      .catch(() => {
        // Stale/deleted conversation — start fresh silently.
        setConversationId(null);
        hydratedRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, entries.length, setConversationId]);

  // Navigate on the agent's request, honoring the global unsaved-changes guard
  // exactly like the sidebar does.
  const guardedNavigate = useCallback(
    async (route: string, label: string) => {
      if (isDirty) {
        const confirmed = await discardDialog.confirm({
          title: "Discard Changes",
          message: `You have unsaved changes. Discard them and open ${label}?`,
          confirmText: "Discard",
          cancelText: "Keep Editing",
          type: "warning",
          confirmColor: "warning",
        });
        if (!confirmed) return;
        executeDiscard();
      }
      navigate(route);
    },
    [isDirty, discardDialog, executeDiscard, navigate],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, open]);

  const patchEntry = useCallback((id: string, patch: (e: ChatEntry) => ChatEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? patch(e) : e)));
  }, []);

  const handleSend = useCallback(() => {
    const message = draft.trim();
    if (!message || isStreaming) return;
    setDraft("");

    const userEntry: ChatEntry = { id: nextId(), role: "user", content: message };
    const assistantEntry: ChatEntry = {
      id: nextId(),
      role: "assistant",
      content: "",
      tools: [],
      streaming: true,
    };
    streamEntryId.current = assistantEntry.id;
    setEntries((prev) => [...prev, userEntry, assistantEntry]);

    void send(message, conversationId, {
      onEvent: (ev) => {
        const sid = streamEntryId.current;
        switch (ev.type) {
          case "meta":
            setConversationId(ev.conversation_id);
            break;
          case "token":
            if (sid) patchEntry(sid, (e) => ({ ...e, content: e.content + ev.content }));
            break;
          case "tool_call":
            if (sid)
              patchEntry(sid, (e) => ({
                ...e,
                tools: [...(e.tools ?? []), ev.name],
              }));
            break;
          case "pending_action":
            setEntries((prev) => [
              ...prev,
              { id: nextId(), role: "info", content: "", action: ev.action },
            ]);
            break;
          case "navigate":
            setEntries((prev) => [
              ...prev,
              { id: nextId(), role: "info", content: `🧭 Opening ${ev.label}…` },
            ]);
            void guardedNavigate(ev.route, ev.label);
            break;
          case "error":
            setEntries((prev) => [
              ...prev,
              { id: nextId(), role: "info", content: ev.message },
            ]);
            break;
          case "done":
            break;
        }
      },
      onFinish: () => {
        const sid = streamEntryId.current;
        if (sid) patchEntry(sid, (e) => ({ ...e, streaming: false }));
        streamEntryId.current = null;
      },
    });
  }, [draft, isStreaming, conversationId, send, patchEntry, setConversationId, guardedNavigate]);

  const handleActionResolved = useCallback(
    (entryId: string, updated: PendingAction, summary: string) => {
      patchEntry(entryId, (e) => ({ ...e, action: updated }));
      setEntries((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "info",
          content:
            updated.status === "executed"
              ? `✅ ${summary}`
              : updated.status === "rejected"
                ? "🚫 Action rejected."
                : `❌ ${summary}`,
        },
      ]);
    },
    [patchEntry],
  );

  const handleNewChat = useCallback(() => {
    stop();
    setEntries([]);
    setConversationId(null);
    hydratedRef.current = null;
    streamEntryId.current = null;
  }, [stop, setConversationId]);

  if (!canUse) return null;

  return (
    <>
      {open && (
        <Paper
          elevation={8}
          sx={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: { xs: "calc(100vw - 32px)", sm: 420 },
            height: "min(640px, calc(100dvh - 96px))",
            display: "flex",
            flexDirection: "column",
            zIndex: (t) => t.zIndex.drawer + 2,
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          {/* header */}
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 1.5, py: 1, bgcolor: "primary.main", color: "primary.contrastText" }}
          >
            <SmartToyOutlinedIcon fontSize="small" />
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Tijaero.AI
            </Typography>
            <Tooltip title="New chat">
              <IconButton size="small" color="inherit" onClick={handleNewChat}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton size="small" color="inherit" onClick={() => setOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          {/* transcript */}
          <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: "auto", p: 1.5, bgcolor: "background.default" }}>
            {entries.length === 0 && (
              <Box sx={{ textAlign: "center", color: "text.secondary", mt: 4, px: 2 }}>
                <SmartToyOutlinedIcon sx={{ fontSize: 40, opacity: 0.4 }} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Ask about purchasing or stock — e.g.
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 1, textAlign: "left" }}>
                  • “What do we owe supplier ABC?”
                  <br />• “Stock level of iPhone 15 in COL branch”
                  <br />• “Overdue purchase invoices this month”
                  <br />• “Create a PO for supplier 3 …”
                </Typography>
              </Box>
            )}

            <Stack spacing={1.25}>
              {entries.map((e) => {
                if (e.action) {
                  return (
                    <ActionCard
                      key={e.id}
                      action={e.action}
                      onResolved={(updated, summary) => handleActionResolved(e.id, updated, summary)}
                    />
                  );
                }
                if (e.role === "info") {
                  return (
                    <Typography
                      key={e.id}
                      variant="caption"
                      sx={{ color: "text.secondary", textAlign: "center", fontStyle: "italic" }}
                    >
                      {e.content}
                    </Typography>
                  );
                }
                const isUser = e.role === "user";
                return (
                  <Box key={e.id} sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                    <Box
                      sx={{
                        maxWidth: "88%",
                        px: 1.25,
                        py: 0.75,
                        borderRadius: 1.5,
                        bgcolor: isUser ? "primary.main" : "background.paper",
                        color: isUser ? "primary.contrastText" : "text.primary",
                        border: isUser ? "none" : "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      {(e.tools?.length ?? 0) > 0 && (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                          {e.tools!.map((t, i) => (
                            <Chip key={`${t}-${i}`} label={t.replace(/_/g, " ")} size="small" variant="outlined" sx={{ fontSize: 10.5, height: 20 }} />
                          ))}
                        </Stack>
                      )}
                      {isUser ? (
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>
                          {e.content}
                        </Typography>
                      ) : e.content ? (
                        <Markdown text={e.content} />
                      ) : e.streaming ? (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                          <CircularProgress size={14} />
                          <Typography variant="caption" color="text.secondary">
                            Working…
                          </Typography>
                        </Stack>
                      ) : null}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Divider />

          {/* composer */}
          <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ p: 1 }}>
            <TextField
              fullWidth
              size="small"
              multiline
              maxRows={4}
              placeholder="Ask the assistant…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Tooltip title="Stop">
                <IconButton color="error" onClick={stop}>
                  <StopCircleOutlinedIcon />
                </IconButton>
              </Tooltip>
            ) : (
              <IconButton color="primary" onClick={handleSend} disabled={!draft.trim()}>
                <SendRoundedIcon />
              </IconButton>
            )}
          </Stack>
        </Paper>
      )}
      <TConfirmDialog {...discardDialog.dialogProps} />
    </>
  );
}
