/**
 * SalesSettingsPage - Settings Hub for Sales Module
 * 
 * Parent page for all sales-related settings including:
 * - Payment Cards (credit/debit with service charges)
 * - Future: Other sales configurations
 */

import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Paper,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
} from "@mui/material";
import {
  Settings as SettingsIcon,
  CreditCard as CardIcon,
  ArrowBack as BackIcon,
} from "@mui/icons-material";
import { TButton } from "@/components/tijaero";
import CardSettingsPage from "./settings/CardSettingsPage";

interface SettingsMenuItem {
  path: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const SETTINGS_MENU: SettingsMenuItem[] = [
  {
    path: "payment-cards",
    label: "Payment Cards",
    description: "Manage credit/debit cards with service charges",
    icon: <CardIcon />,
  },
  // Future settings can be added here
  // {
  //   path: "invoice-settings",
  //   label: "Invoice Settings",
  //   description: "Configure invoice numbering, templates, etc.",
  //   icon: <ReceiptIcon />,
  // },
];

export default function SalesSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Check if we're on the main settings page (no sub-path)
  const isMainSettingsPage = location.pathname.endsWith("/settings") || 
                              location.pathname.endsWith("/settings/");

  // Auto-select first menu item when landing on main settings page
  useEffect(() => {
    if (isMainSettingsPage && SETTINGS_MENU.length > 0) {
      navigate(SETTINGS_MENU[0].path, { replace: true });
    }
  }, [isMainSettingsPage, navigate]);

  const getActiveItem = () => {
    const currentPath = location.pathname;
    return SETTINGS_MENU.find((item) => currentPath.includes(item.path))?.path || "";
  };

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const handleBack = () => {
    navigate("/sales");
  };

  return (
    <Box sx={{ display: "flex", height: "100%", bgcolor: "background.default" }}>
      {/* Sidebar Navigation */}
      <Paper
        elevation={0}
        sx={{
          width: 280,
          minWidth: 280,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2 }}>
          <TButton
            variant="text"
            startIcon={<BackIcon />}
            onClick={handleBack}
            size="small"
            sx={{ mb: 1 }}
          >
            Back to Sales
          </TButton>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <SettingsIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              Sales Settings
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Configure sales module preferences
          </Typography>
        </Box>

        <Divider />

        {/* Menu Items */}
        <List sx={{ flex: 1, py: 1 }}>
          {SETTINGS_MENU.map((item) => (
            <ListItemButton
              key={item.path}
              selected={getActiveItem() === item.path}
              onClick={() => handleNavigate(item.path)}
              sx={{
                mx: 1,
                borderRadius: 1,
                mb: 0.5,
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "white",
                  "&:hover": {
                    bgcolor: "primary.dark",
                  },
                  "& .MuiListItemIcon-root": {
                    color: "white",
                  },
                  "& .MuiListItemText-secondary": {
                    color: "rgba(255, 255, 255, 0.85)",
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.description}
                primaryTypographyProps={{ fontWeight: 500 }}
                secondaryTypographyProps={{ 
                  variant: "caption",
                  sx: { lineHeight: 1.3, mt: 0.25 }
                }}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      {/* Content Area */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {isMainSettingsPage ? (
          // Landing page when accessing /sales/settings directly
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 2,
              p: 4,
            }}
          >
            <SettingsIcon sx={{ fontSize: 64, color: "text.secondary" }} />
            <Typography variant="h5" color="text.secondary">
              Sales Settings
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Select an option from the sidebar to configure sales module settings.
            </Typography>
          </Box>
        ) : (
          <Routes>
            <Route path="payment-cards" element={<CardSettingsPage />} />
            <Route path="*" element={<Navigate to="payment-cards" replace />} />
          </Routes>
        )}
      </Box>
    </Box>
  );
}
