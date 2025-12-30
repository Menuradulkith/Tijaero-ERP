import { useState } from "react";
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Tabs,
  Tab,
} from "@mui/material";
import {
  AccountBalance,
  CreditCard,
  Receipt,
  TrendingUp,
  Payment,
  Description,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);

  const modules = [
    {
      title: "Bank Deposits",
      icon: <AccountBalance sx={{ fontSize: 40 }} />,
      description: "Manage bank deposits and verify transactions",
      path: "/finance/bank-deposits",
      color: "#1976d2",
    },
    {
      title: "Card Payments",
      icon: <CreditCard sx={{ fontSize: 40 }} />,
      description: "Track credit and debit card payments",
      path: "/finance/card-payments",
      color: "#2e7d32",
    },
    {
      title: "Cheque Payments",
      icon: <Payment sx={{ fontSize: 40 }} />,
      description: "Manage cheque payments and deposits",
      path: "/finance/cheque-payments",
      color: "#ed6c02",
    },
    {
      title: "Expenses",
      icon: <Receipt sx={{ fontSize: 40 }} />,
      description: "Record and track business expenses",
      path: "/finance/expenses",
      color: "#d32f2f",
    },
    {
      title: "Advance Payments",
      icon: <TrendingUp sx={{ fontSize: 40 }} />,
      description: "Customer advance payment management",
      path: "/finance/advance-payments",
      color: "#7b1fa2",
    },
    {
      title: "Credit Notes",
      icon: <Description sx={{ fontSize: 40 }} />,
      description: "Issue and manage customer credit notes",
      path: "/finance/credit-notes",
      color: "#0288d1",
    },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Finance & Accounting
        </Typography>
      </Box>

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 2 }}>
        <Tab label="Overview" />
        <Tab label="Payments" />
        <Tab label="Reports" />
      </Tabs>

      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {modules.map((module) => (
            <Grid item xs={12} sm={6} md={4} key={module.title}>
              <Card
                sx={{
                  height: "100%",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  "&:hover": {
                    transform: "translateY(-4px)",
                    boxShadow: 4,
                  },
                }}
                onClick={() => navigate(module.path)}
              >
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      mb: 2,
                      color: module.color,
                    }}
                  >
                    {module.icon}
                    <Typography variant="h6" sx={{ ml: 2 }}>
                      {module.title}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {module.description}
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{ mt: 2 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(module.path);
                    }}
                  >
                    Open
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Typography variant="h6" gutterBottom>
          Payment Summary
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Bank Deposits
                </Typography>
                <Typography variant="h4">$0.00</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Card Payments
                </Typography>
                <Typography variant="h4">$0.00</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Cheque Payments
                </Typography>
                <Typography variant="h4">$0.00</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Expenses
                </Typography>
                <Typography variant="h4">$0.00</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Typography variant="h6" gutterBottom>
          Financial Reports
        </Typography>
        <Typography color="text.secondary">
          Reports functionality coming soon...
        </Typography>
      </TabPanel>
    </Box>
  );
}
