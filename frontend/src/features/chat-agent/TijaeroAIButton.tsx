/**
 * Tijaero.AI — header-bar trigger for the AI chat widget.
 * Renders nothing when the user lacks the `ai_assistant:view` permission.
 */
import { Button, Tooltip } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { usePermission } from "@/auth/permissions";
import { useChatAgentUi } from "./chatAgentStore";

export default function TijaeroAIButton() {
  const canUse = usePermission("ai_assistant", "view");
  const toggle = useChatAgentUi((s) => s.toggle);
  const open = useChatAgentUi((s) => s.open);

  if (!canUse) return null;

  return (
    <Tooltip title="Tijaero.AI assistant">
      <Button
        onClick={toggle}
        size="small"
        startIcon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
        sx={{
          textTransform: "none",
          fontWeight: 700,
          px: 1.25,
          minWidth: 0,
          borderRadius: 2,
          color: open ? "primary.contrastText" : "primary.main",
          bgcolor: open ? "primary.main" : "transparent",
          border: "1px solid",
          borderColor: "primary.main",
          "&:hover": {
            bgcolor: open ? "primary.dark" : "primary.main",
            color: "primary.contrastText",
          },
          "& .MuiButton-startIcon": { mr: 0.5 },
        }}
      >
        Tijaero.AI
      </Button>
    </Tooltip>
  );
}
