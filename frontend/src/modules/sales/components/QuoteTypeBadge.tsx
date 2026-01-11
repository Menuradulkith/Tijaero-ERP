import { Receipt as ProformaIcon, Description as QuotationIcon } from '@mui/icons-material';
import { Chip } from '@mui/material';
import React from 'react';
import { QUOTE_TYPE_LABELS, QuoteType } from '../quotation-types';

interface QuoteTypeBadgeProps {
  type: QuoteType;
  size?: 'small' | 'medium';
  showIcon?: boolean;
}

export const QuoteTypeBadge: React.FC<QuoteTypeBadgeProps> = ({ 
  type, 
  size = 'small',
  showIcon = true 
}) => {
  const isQuotation = type === 'quotation';
  
  return (
    <Chip
      icon={showIcon ? (isQuotation ? <QuotationIcon /> : <ProformaIcon />) : undefined}
      label={QUOTE_TYPE_LABELS[type] || type}
      color={isQuotation ? 'primary' : 'secondary'}
      size={size}
      variant="outlined"
    />
  );
};

export default QuoteTypeBadge;
