import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  Typography,
  CircularProgress,
  Chip,
} from '@mui/material';

interface TransferDialogProps {
  open: boolean;
  item: any;
  type: 'toAsset' | 'toStock';
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

export const TransferDialog: React.FC<TransferDialogProps> = ({
  open,
  item,
  type,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToStock = type === 'toStock';
  const isReasonRequired = isToStock;

  const handleConfirm = async () => {
    // Validate required fields
    if (isReasonRequired && !reason.trim()) {
      setError('Reason is required for returning to sales stock');
      return;
    }

    if (!item) {
      setError('No item selected');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onConfirm(reason);
      // Reset form on success
      setReason('');
    } catch (err: any) {
      setError(err.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setReason('');
      setError('');
      onCancel();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isToStock
          ? 'Return to Sales Stock'
          : 'Move to Company Assets'}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Info Alert */}
          <Alert severity="info" sx={{ mb: 2 }}>
            {isToStock
              ? 'This item will be moved from Company Assets to Sales Stock for resale'
              : 'This item will be moved from Sales Stock to Company Assets'}
          </Alert>

          {/* Item Details Section */}
          {item && (
            <Box sx={{ mb: 3, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                Item Details
              </Typography>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  <strong>Barcode:</strong>
                </Typography>
                <Chip label={item.barcode} size="small" />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  <strong>Product:</strong>
                </Typography>
                <Typography variant="body2">
                  {item.product?.name || item.product || 'N/A'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  <strong>Status:</strong>
                </Typography>
                <Chip label={item.status || 'available'} size="small" color="success" />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">
                  <strong>Branch:</strong>
                </Typography>
                <Typography variant="body2">
                  {item.branch_code || 'HQ'}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Error Message */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Reason Field */}
          <TextField
            label="Reason for Transfer"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(''); // Clear error on input change
            }}
            fullWidth
            multiline
            rows={3}
            margin="normal"
            required={isReasonRequired}
            placeholder={
              isToStock
                ? 'Explain why you are returning this item to sales stock (e.g., Surplus, damaged packaging, etc.)'
                : 'Explain why you are moving this item to company assets (optional)'
            }
            disabled={loading}
            helperText={
              isReasonRequired
                ? 'Reason is required for company asset transfers'
                : 'Optional - provide context for audit trail'
            }
          />

          {/* Transfer Type Indicator */}
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #eee' }}>
            <Typography variant="caption" color="textSecondary">
              <strong>Transfer Details:</strong>
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={isToStock ? 'Company Assets' : 'Sales Stock'}
                size="small"
                variant="outlined"
              />
              <Typography variant="caption">→</Typography>
              <Chip
                label={isToStock ? 'Sales Stock' : 'Company Assets'}
                size="small"
                variant="outlined"
                color="primary"
              />
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
          disabled={loading || !item}
          sx={{
            minWidth: 120,
            position: 'relative',
          }}
        >
          {loading ? (
            <>
              <CircularProgress size={20} sx={{ mr: 1 }} />
              Transferring...
            </>
          ) : (
            'Confirm Transfer'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TransferDialog;
