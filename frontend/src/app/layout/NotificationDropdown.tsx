import { useNotifications } from "@/hooks/useNotifications";
import { AppNotification } from "@/modules/notifications/types";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import NotificationsIcon from "@mui/icons-material/Notifications";
import WarningIcon from "@mui/icons-material/Warning";
import {
    Badge,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Menu,
    Tooltip,
    Typography,
} from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const getNotificationIcon = (type: AppNotification["notification_type"]) => {
  switch (type) {
    case "success":
      return <CheckCircleIcon color="success" fontSize="small" />;
    case "warning":
      return <WarningIcon color="warning" fontSize="small" />;
    case "error":
      return <ErrorIcon color="error" fontSize="small" />;
    case "info":
    default:
      return <InfoIcon color="info" fontSize="small" />;
  }
};

export default function NotificationDropdown() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const {
    notifications,
    stats,
    isLoading,
    isError,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingAllRead,
    isDeleting,
  } = useNotifications();

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    if (notification.action_url) {
      handleMenuClose();
      navigate(notification.action_url);
    }
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNotification(id);
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={handleMenuOpen}
        sx={{ display: { xs: "none", sm: "inline-flex" } }}
      >
        <Badge badgeContent={stats?.unread || 0} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        slotProps={{
          paper: {
            sx: {
              width: 350,
              maxHeight: 500,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            },
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1,
          }}
        >
          <Typography variant="subtitle1" fontWeight="600">
            Notifications
          </Typography>
          {stats?.unread ? (
            <Tooltip title="Mark all as read">
              <IconButton
                size="small"
                onClick={() => markAllAsRead()}
                disabled={isMarkingAllRead}
              >
                {isMarkingAllRead ? (
                  <CircularProgress size={20} />
                ) : (
                  <DoneAllIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
        <Divider />

        <List sx={{ p: 0, overflow: "auto", flexGrow: 1 }}>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : isError ? (
            <ListItem>
              <ListItemText
                primary="Failed to load notifications"
                secondary="Please try again later"
                primaryTypographyProps={{
                  color: "error.main",
                  fontWeight: "bold",
                }}
                sx={{ textAlign: "center", py: 2 }}
              />
            </ListItem>
          ) : notifications.length === 0 ? (
            <ListItem>
              <ListItemText
                primary="No notifications"
                secondary="You're all caught up!"
                sx={{ textAlign: "center", py: 2 }}
              />
            </ListItem>
          ) : (
            notifications.map((notification) => (
              <ListItem
                key={notification.id}
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={(e) => handleDelete(notification.id, e)}
                    disabled={isDeleting}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemButton
                  onClick={() => handleNotificationClick(notification)}
                  sx={{
                    opacity: notification.is_read ? 0.7 : 1,
                    bgcolor: notification.is_read
                      ? "transparent"
                      : "action.hover",
                    alignItems: "flex-start",
                  }}
                >
                  <Box sx={{ mr: 2, mt: 0.5 }}>
                    {getNotificationIcon(notification.notification_type)}
                  </Box>
                  <ListItemText
                    primary={notification.title}
                    secondary={
                      <React.Fragment>
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.primary"
                          sx={{ display: "block", mt: 0.5, mb: 0.5 }}
                        >
                          {notification.message}
                        </Typography>
                        <Box
                          component="span"
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            flexWrap: "wrap",
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {formatDistanceToNow(
                              new Date(notification.created_date),
                              {
                                addSuffix: true,
                              },
                            )}
                          </Typography>
                          {notification.branch_code ? (
                            <Chip
                              component="span"
                              size="small"
                              variant="outlined"
                              label={notification.branch_code}
                              sx={{ height: 18, fontSize: 10 }}
                            />
                          ) : null}
                          {notification.category &&
                          notification.category !== "system" ? (
                            <Chip
                              component="span"
                              size="small"
                              label={notification.category}
                              sx={{
                                height: 18,
                                fontSize: 10,
                                textTransform: "capitalize",
                              }}
                            />
                          ) : null}
                        </Box>
                      </React.Fragment>
                    }
                    primaryTypographyProps={{
                      fontWeight: notification.is_read ? "normal" : "bold",
                      variant: "body2",
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
        <Divider />
        <Box sx={{ p: 1, textAlign: "center" }}>
          <Button size="small" fullWidth onClick={handleMenuClose}>
            Close
          </Button>
        </Box>
      </Menu>
    </>
  );
}
