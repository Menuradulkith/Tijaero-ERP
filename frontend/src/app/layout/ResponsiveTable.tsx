import { ReactNode } from "react";
import {
  TableContainer,
  Paper,
  useMediaQuery,
  useTheme,
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
} from "@mui/material";

interface ResponsiveTableProps {
  children: ReactNode;
  mobileCards?: (item: any, index: number) => ReactNode;
  data?: any[];
  elevation?: number;
}

/**
 * ResponsiveTable - A wrapper component that shows tables on desktop
 * and can optionally show card-based layout on mobile
 */
export default function ResponsiveTable({
  children,
  mobileCards,
  data = [],
  elevation = 2,
}: ResponsiveTableProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  // If mobile cards are provided and we're on mobile, show cards
  if (isMobile && mobileCards && data.length > 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {data.map((item, index) => mobileCards(item, index))}
      </Box>
    );
  }

  // Otherwise show the table with horizontal scroll
  return (
    <TableContainer
      component={Paper}
      elevation={elevation}
      sx={{
        overflowX: "auto",
        // Add momentum scrolling for iOS
        WebkitOverflowScrolling: "touch",
      }}
    >
      {children}
    </TableContainer>
  );
}

/**
 * MobileCard - A helper component for creating mobile-friendly cards
 */
interface MobileCardProps {
  children: ReactNode;
  onClick?: () => void;
}

export function MobileCard({ children, onClick }: MobileCardProps) {
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick
          ? {
              boxShadow: 3,
              transform: "translateY(-2px)",
              transition: "all 0.2s",
            }
          : {},
      }}
    >
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * MobileCardRow - A helper component for card rows
 */
interface MobileCardRowProps {
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
}

export function MobileCardRow({
  label,
  value,
  fullWidth = false,
}: MobileCardRowProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: fullWidth ? "column" : "row",
        justifyContent: "space-between",
        alignItems: fullWidth ? "flex-start" : "center",
        py: 0.5,
        gap: fullWidth ? 0.5 : 1,
      }}
    >
      <Typography variant="body2" color="text.secondary" fontWeight={500}>
        {label}:
      </Typography>
      <Box>{value}</Box>
    </Box>
  );
}

/**
 * MobileCardDivider - A helper component for card dividers
 */
export function MobileCardDivider() {
  return <Divider sx={{ my: 1 }} />;
}
