import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Box,
  TextField,
  Paper,
  Typography,
  Button,
  InputAdornment,
  Stepper,
  Step,
  StepLabel,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  CircularProgress,
  Switch,
  FormControlLabel,
  MenuItem,
} from "@mui/material";
import {
  QrCodeScanner as ScanIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Save as SaveIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Tijaero UI Components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  TFilterPanel,
  TStatusChip,
  TAlert,
  modernTableStyles,
  getStatusProps,
} from "@/components/tijaero";

// API
import { transferNotesApi, receiveNotesApi } from "@/modules/warehouse/api";
import type {
  ItemReceiveNote,
  ItemTransferNoteItem,
  ItemTransferNoteWithItems,
} from "../types";

interface ReceivedItem {
  transferItemId: number;
  productId: number;
  productName: string;
  barcode?: string;
  expectedQuantity: number;
  receivedQuantity: number;
  scannedSerials: string[];
  damageQuantity: number;
  notes: string;
}

interface ScanResult {
  success: boolean;
  message: string;
  productInfo?: {
    id: number;
    name: string;
    partNumber: string;
  };
}

const STEPS = [
  "Select Transfer Note",
  "Receive Items",
  "Review & Complete",
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

export default function ReceiveNotesPage() {
  const queryClient = useQueryClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // State
  const [selectedIRN, setSelectedIRN] = useState<ItemReceiveNote | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Create Mode State
  const [selectedITN, setSelectedITN] = useState<ItemTransferNoteWithItems | null>(null);
  const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);
  const [useBarcodeScanning, setUseBarcodeScanning] = useState(true);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [notes, setNotes] = useState("");

  // Fetch Item Receive Notes
  const {
    data: receiveNotesData,
    isLoading: isLoadingIRNs,
    error: irnError,
    refetch: refetchIRNs,
  } = useQuery({
    queryKey: ["itemReceiveNotes", statusFilter],
    queryFn: async () => {
      try {
        const response = await receiveNotesApi.getAll({
          approved_status: statusFilter ? (statusFilter === "approved" ? 1 : 0) : undefined,
          skip: 0,
          limit: 100,
        });
        return { items: Array.isArray(response) ? response : [], total: Array.isArray(response) ? response.length : 0 };
      } catch (err) {
        console.error("Error fetching receive notes:", err);
        return { items: [], total: 0 };
      }
    },
  });

  // Fetch Available Transfer Notes (approved, not yet received)
  const { data: availableITNs, isLoading: isLoadingITNs } = useQuery<ItemTransferNoteWithItems[]>({
    queryKey: ["availableTransferNotes"],
    queryFn: async () => {
      try {
        const response = await transferNotesApi.getAll({
          skip: 0,
          limit: 100,
        });
        const allNotes = Array.isArray(response) ? response : [];
        // Fetch each note with items
        const notesWithItems = await Promise.all(
          allNotes.map((note) => transferNotesApi.getById(note.id))
        );
        return notesWithItems.filter(
          (note) =>
            ["approved", "dispatched", "in_transit", "partially_received"].includes(
              note.status || ""
            )
        );
      } catch (err) {
        console.error("Error fetching transfer notes:", err);
        return [];
      }
    },
    enabled: isCreating && activeStep === 0,
  });

  // Mutations
  const receiveItemsMutation = useMutation({
    mutationFn: async (data: {
      transferNoteId: number;
      barcodes: string[];
      notes: string;
    }) => {
      return receiveNotesApi.receiveItems(data.transferNoteId, {
        barcodes: data.barcodes,
        received_note: data.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["itemReceiveNotes"] });
      queryClient.invalidateQueries({ queryKey: ["availableTransferNotes"] });
      handleCancelCreate();
      setScanResult({
        success: true,
        message: "Items received successfully!",
      });
    },
    onError: (error: any) => {
      setScanResult({
        success: false,
        message: error.response?.data?.detail || "Failed to create receive note",
      });
    },
  });

  // Get filtered receive notes
  const receiveNotes = useMemo(() => {
    const items = receiveNotesData?.items || [];
    if (!searchQuery) return items;
    const lowerQuery = searchQuery.toLowerCase();
    return items.filter(
      (irn: ItemReceiveNote) =>
        `IRN-${irn.id}`.toLowerCase().includes(lowerQuery) ||
        `ITN-${irn.item_transfer_note_id}`.toLowerCase().includes(lowerQuery)
    );
  }, [receiveNotesData, searchQuery]);

  // Handlers
  const handleSelectIRN = useCallback((irn: ItemReceiveNote) => {
    setSelectedIRN(irn);
    setIsCreating(false);
    setActiveStep(0);
  }, []);

  const handleNewIRN = useCallback(() => {
    setSelectedIRN(null);
    setIsCreating(true);
    setActiveStep(0);
    setSelectedITN(null);
    setReceivedItems([]);
    setBarcodeInput("");
    setScanResult(null);
    setNotes("");
  }, []);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(false);
    setActiveStep(0);
    setSelectedITN(null);
    setReceivedItems([]);
    setBarcodeInput("");
    setScanResult(null);
    setNotes("");
  }, []);

  const handleSelectTransferNote = useCallback((itn: ItemTransferNoteWithItems) => {
    setSelectedITN(itn);
    // Initialize received items from transfer note items
    const items: ReceivedItem[] = (itn.items || []).map((item: ItemTransferNoteItem) => ({
      transferItemId: item.id,
      productId: item.product_id,
      productName: item.product_name || `Product #${item.product_id}`,
      barcode: item.barcode,
      expectedQuantity: 1, // Each item represents 1 barcode
      receivedQuantity: item.item_recieved ? 1 : 0,
      scannedSerials: item.item_recieved && item.barcode ? [item.barcode] : [],
      damageQuantity: 0,
      notes: "",
    }));
    setReceivedItems(items);
    setActiveStep(1);
  }, []);

  const handleBarcodeScan = useCallback(() => {
    if (!barcodeInput.trim()) return;

    const matchedItem = receivedItems.find(
      (item) => item.barcode && item.barcode.toLowerCase() === barcodeInput.toLowerCase()
    );

    if (matchedItem) {
      setReceivedItems((prev) =>
        prev.map((item) =>
          item.transferItemId === matchedItem.transferItemId
            ? {
                ...item,
                receivedQuantity: Math.min(1, item.expectedQuantity),
                scannedSerials: item.scannedSerials.includes(barcodeInput)
                  ? item.scannedSerials
                  : [...item.scannedSerials, barcodeInput],
              }
            : item
        )
      );
      setScanResult({
        success: true,
        message: `Scanned: ${matchedItem.productName}`,
        productInfo: {
          id: matchedItem.productId,
          name: matchedItem.productName,
          partNumber: barcodeInput,
        },
      });
    } else {
      setScanResult({
        success: false,
        message: `No matching item found for barcode: ${barcodeInput}`,
      });
    }

    setBarcodeInput("");
    barcodeInputRef.current?.focus();
  }, [barcodeInput, receivedItems]);

  const handleQuantityChange = useCallback(
    (transferItemId: number, quantity: number) => {
      setReceivedItems((prev) =>
        prev.map((item) =>
          item.transferItemId === transferItemId
            ? { ...item, receivedQuantity: Math.max(0, Math.min(1, quantity)) }
            : item
        )
      );
    },
    []
  );

  const handleDamageChange = useCallback(
    (transferItemId: number, quantity: number) => {
      setReceivedItems((prev) =>
        prev.map((item) =>
          item.transferItemId === transferItemId
            ? { ...item, damageQuantity: Math.max(0, quantity) }
            : item
        )
      );
    },
    []
  );

  const handleItemNotesChange = useCallback(
    (transferItemId: number, notes: string) => {
      setReceivedItems((prev) =>
        prev.map((item) =>
          item.transferItemId === transferItemId ? { ...item, notes } : item
        )
      );
    },
    []
  );

  const handleReceiveAll = useCallback(() => {
    setReceivedItems((prev) =>
      prev.map((item) => ({
        ...item,
        receivedQuantity: item.expectedQuantity,
        scannedSerials: item.barcode ? [item.barcode] : item.scannedSerials,
      }))
    );
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedITN) return;
    const receivedBarcodes = receivedItems
      .filter((item) => item.receivedQuantity > 0 && item.barcode)
      .map((item) => item.barcode as string);

    receiveItemsMutation.mutate({
      transferNoteId: selectedITN.id,
      barcodes: receivedBarcodes,
      notes,
    });
  }, [selectedITN, receivedItems, notes, receiveItemsMutation]);

  const handleNext = useCallback(() => {
    if (activeStep === 0 && !selectedITN) {
      setScanResult({ success: false, message: "Please select a transfer note" });
      return;
    }
    if (activeStep === 1) {
      const hasReceivedItems = receivedItems.some((item) => item.receivedQuantity > 0);
      if (!hasReceivedItems) {
        setScanResult({ success: false, message: "Please receive at least one item" });
        return;
      }
    }
    setActiveStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    setScanResult(null);
  }, [activeStep, selectedITN, receivedItems]);

  const handleBack = useCallback(() => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
    setScanResult(null);
  }, []);

  // Focus barcode input when entering step 2
  useEffect(() => {
    if (activeStep === 1 && useBarcodeScanning && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [activeStep, useBarcodeScanning]);

  // Render Master Panel (List)
  const renderListItem = (irn: ItemReceiveNote) => {
    const statusLabel = irn.received_approval_status === 1 ? "approved" : "pending";
    const statusProps = getStatusProps(statusLabel, "orderStatus");
    return (
      <SelectableListItem
        key={irn.id}
        isSelected={selectedIRN?.id === irn.id}
        onClick={() => handleSelectIRN(irn)}
        primaryText={`IRN-${irn.id}`}
        secondaryText={`Transfer: ITN-${irn.item_transfer_note_id} • ${
          irn.recieved_date
            ? format(new Date(irn.recieved_date), "dd MMM yyyy")
            : "Not received"
        }`}
        statusChip={statusProps}
      />
    );
  };

  const masterPanel = (
    <SearchableList
      searchPlaceholder="Search receive notes..."
      onSearchChange={setSearchQuery}
      listHeader={
        <TFilterPanel>
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </TFilterPanel>
      }
    >
      {isLoadingIRNs ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : irnError ? (
        <TAlert severity="error" sx={{ m: 1 }}>
          Failed to load receive notes
        </TAlert>
      ) : receiveNotes.length === 0 ? (
        <Box sx={{ p: 2, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            No receive notes found
          </Typography>
        </Box>
      ) : (
        receiveNotes.map(renderListItem)
      )}
    </SearchableList>
  );

  // Render Step Content
  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <FormSection title="Select Transfer Note" columns={1}>
            {isLoadingITNs ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : (availableITNs || []).length === 0 ? (
              <TAlert severity="info">
                No approved transfer notes available for receiving
              </TAlert>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {(availableITNs || []).map((itn: ItemTransferNoteWithItems) => (
                  <Paper
                    key={itn.id}
                    sx={{
                      p: 2,
                      cursor: "pointer",
                      border: selectedITN?.id === itn.id ? 2 : 1,
                      borderColor:
                        selectedITN?.id === itn.id ? "primary.main" : "divider",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                    onClick={() => handleSelectTransferNote(itn)}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle1" fontWeight="medium">
                          {itn.item_transfer_note}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          From: {itn.from_location_name || "N/A"} → To:{" "}
                          {itn.to_location_name || "N/A"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Items: {itn.items?.length || 0}
                        </Typography>
                      </Box>
                      <TStatusChip
                        status={itn.status || "approved"}
                        {...getStatusProps(itn.status || "approved", "orderStatus")}
                        size="small"
                      />
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}
          </FormSection>
        );

      case 1:
        return (
          <>
            <FormSection title="Scanning Mode" columns={1}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={useBarcodeScanning}
                      onChange={(e) => setUseBarcodeScanning(e.target.checked)}
                    />
                  }
                  label="Barcode Scanning"
                />
                {useBarcodeScanning && (
                  <TextField
                    inputRef={barcodeInputRef}
                    size="small"
                    placeholder="Scan barcode..."
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleBarcodeScan();
                      }
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <ScanIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ width: 300 }}
                  />
                )}
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleReceiveAll}
                  startIcon={<CheckCircleIcon />}
                >
                  Receive All
                </Button>
              </Box>
            </FormSection>

            <FormSection title="Items to Receive" columns={1}>
              {scanResult && (
                <TAlert
                  severity={scanResult.success ? "success" : "error"}
                  sx={{ mb: 2 }}
                  onClose={() => setScanResult(null)}
                >
                  {scanResult.message}
                </TAlert>
              )}

              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell align="center">
                        Expected
                      </TableCell>
                      <TableCell align="center">
                        Received
                      </TableCell>
                      <TableCell align="center">
                        Damaged
                      </TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {receivedItems.map((item) => (
                      <TableRow key={item.transferItemId} sx={modernTableStyles.bodyRow}>
                        <TableCell>
                          <Typography variant="body2">{item.productName}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={item.expectedQuantity}
                            size="small"
                            color="default"
                          />
                        </TableCell>
                        <TableCell align="center">
                          <TextField
                            type="number"
                            size="small"
                            value={item.receivedQuantity}
                            onChange={(e) =>
                              handleQuantityChange(
                                item.transferItemId,
                                parseInt(e.target.value) || 0
                              )
                            }
                            inputProps={{
                              min: 0,
                              max: item.expectedQuantity,
                              style: { textAlign: "center", width: 60 },
                            }}
                            sx={{ width: 80 }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <TextField
                            type="number"
                            size="small"
                            value={item.damageQuantity}
                            onChange={(e) =>
                              handleDamageChange(
                                item.transferItemId,
                                parseInt(e.target.value) || 0
                              )
                            }
                            inputProps={{
                              min: 0,
                              style: { textAlign: "center", width: 60 },
                            }}
                            sx={{ width: 80 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            placeholder="Notes..."
                            value={item.notes}
                            onChange={(e) =>
                              handleItemNotesChange(item.transferItemId, e.target.value)
                            }
                            fullWidth
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>
          </>
        );

      case 2:
        const totalExpected = receivedItems.reduce(
          (sum, item) => sum + item.expectedQuantity,
          0
        );
        const totalReceived = receivedItems.reduce(
          (sum, item) => sum + item.receivedQuantity,
          0
        );
        const totalDamaged = receivedItems.reduce(
          (sum, item) => sum + item.damageQuantity,
          0
        );

        return (
          <>
            <FormSection title="Summary" columns={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Transfer Note
                </Typography>
                <Typography variant="body1">
                  {selectedITN?.item_transfer_note || "-"}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  From Location
                </Typography>
                <Typography variant="body1">
                  {selectedITN?.from_location_name || "-"}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  To Location
                </Typography>
                <Typography variant="body1">
                  {selectedITN?.to_location_name || "-"}
                </Typography>
              </Box>
            </FormSection>

            <FormSection title="Receiving Summary" columns={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Expected Items
                </Typography>
                <Typography variant="h6">{totalExpected}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Received Items
                </Typography>
                <Typography variant="h6" color="success.main">
                  {totalReceived}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Damaged Items
                </Typography>
                <Typography variant="h6" color="error.main">
                  {totalDamaged}
                </Typography>
              </Box>
            </FormSection>

            <FormSection title="Received Items" columns={1}>
              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell align="center">
                        Expected
                      </TableCell>
                      <TableCell align="center">
                        Received
                      </TableCell>
                      <TableCell align="center">
                        Damaged
                      </TableCell>
                      <TableCell align="center">
                        Status
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {receivedItems.map((item) => {
                      const isComplete =
                        item.receivedQuantity === item.expectedQuantity;
                      const isPartial =
                        item.receivedQuantity > 0 &&
                        item.receivedQuantity < item.expectedQuantity;
                      return (
                        <TableRow key={item.transferItemId} sx={modernTableStyles.bodyRow}>
                          <TableCell>
                            {item.productName}
                          </TableCell>
                          <TableCell align="center">
                            {item.expectedQuantity}
                          </TableCell>
                          <TableCell align="center">
                            {item.receivedQuantity}
                          </TableCell>
                          <TableCell align="center">
                            {item.damageQuantity}
                          </TableCell>
                          <TableCell align="center">
                            <TStatusChip
                              status={
                                isComplete
                                  ? "approved"
                                  : isPartial
                                  ? "pending"
                                  : "pending"
                              }
                              {...getStatusProps(
                                isComplete
                                  ? "approved"
                                  : isPartial
                                  ? "pending"
                                  : "pending",
                                "orderStatus"
                              )}
                              size="small"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            <FormSection title="Notes" columns={1}>
              <TextField
                multiline
                rows={3}
                placeholder="Add any additional notes about this receipt..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                fullWidth
              />
            </FormSection>
          </>
        );

      default:
        return null;
    }
  };

  // Render View Mode (Selected IRN)
  const renderViewMode = () => {
    if (!selectedIRN) return null;
    const statusLabel = selectedIRN.received_approval_status === 1 ? "approved" : "pending";

    return (
      <>
        <FormSection title="Receive Note Details" columns={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Receive Note Number
            </Typography>
            <Typography variant="body1">
              IRN-{selectedIRN.id}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Transfer Note
            </Typography>
            <Typography variant="body1">
              ITN-{selectedIRN.item_transfer_note_id}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Status
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <TStatusChip
                status={statusLabel}
                {...getStatusProps(statusLabel, "orderStatus")}
                size="small"
              />
            </Box>
          </Box>
        </FormSection>

        <FormSection title="Dates" columns={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Received Date
            </Typography>
            <Typography variant="body1">
              {selectedIRN.recieved_date
                ? format(new Date(selectedIRN.recieved_date), "dd MMM yyyy HH:mm")
                : "-"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Received By
            </Typography>
            <Typography variant="body1">
              {selectedIRN.recieved_user ? `User #${selectedIRN.recieved_user}` : "-"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Approval Status
            </Typography>
            <Typography variant="body1">
              {selectedIRN.received_approval_status === 1 ? "Approved" : "Pending"}
            </Typography>
          </Box>
        </FormSection>

        {selectedIRN.received_note && (
          <FormSection title="Notes" columns={1}>
            <Typography variant="body2">{selectedIRN.received_note}</Typography>
          </FormSection>
        )}
      </>
    );
  };

  // Render Detail Panel
  const detailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Item Receive Notes", href: "/warehouse/receive-notes" },
          ...(selectedIRN || isCreating
            ? [{ label: isCreating ? "New Receive Note" : `IRN-${selectedIRN?.id}` }]
            : []),
        ]}
        title={
          isCreating
            ? "New Item Receive Note"
            : selectedIRN
            ? `IRN-${selectedIRN.id}`
            : ""
        }
        isCreating={isCreating}
        createTitle="New Item Receive Note"
        noSelectionTitle="Select a Receive Note"
        subtitle={
          isCreating
            ? STEPS[activeStep]
            : selectedIRN
            ? `Transfer: ITN-${selectedIRN.item_transfer_note_id}`
            : "Select or create a receive note"
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedIRN}
        isCreating={isCreating}
        isEditing={false}
        isSaving={false}
        isFormValid={true}
        onNew={handleNewIRN}
        onCancel={isCreating ? handleCancelCreate : undefined}
        canUpdate={false}
        canDelete={false}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedIRN && !isCreating ? (
          <EmptyState
            message="Select a receive note from the list or create a new one"
            icon="inbox"
          />
        ) : (
          <>
            {isCreating && (
              <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                {STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {scanResult && !isCreating && (
              <TAlert
                severity={scanResult.success ? "success" : "error"}
                sx={{ mb: 2 }}
                onClose={() => setScanResult(null)}
              >
                {scanResult.message}
              </TAlert>
            )}

            {isCreating ? renderStepContent() : renderViewMode()}

            {isCreating && (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mt: 3,
                  pt: 2,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                <Button
                  variant="outlined"
                  startIcon={<ArrowBackIcon />}
                  onClick={handleBack}
                  disabled={activeStep === 0}
                >
                  Back
                </Button>

                {activeStep === STEPS.length - 1 ? (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    onClick={handleSubmit}
                    disabled={receiveItemsMutation.isPending}
                  >
                    {receiveItemsMutation.isPending ? "Receiving..." : "Receive Items"}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    endIcon={<ArrowForwardIcon />}
                    onClick={handleNext}
                  >
                    Next
                  </Button>
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Item Receive Notes"
      masterPanel={masterPanel}
      detailPanel={detailPanel}
      onRefresh={() => refetchIRNs()}
    />
  );
}
