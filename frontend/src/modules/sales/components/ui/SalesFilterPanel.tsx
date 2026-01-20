import { ReactNode } from "react";
import {
  TBranchFilter,
  TFilterPanel,
  TStatusFilter,
  type TFilterBranch,
  type TFilterStatusOption,
} from "@/components/tijaero";

interface SalesFilterPanelProps {
  branches?: TFilterBranch[];
  branchValue?: string | null;
  onBranchChange?: (branchCode: string | null) => void;
  statusOptions?: TFilterStatusOption[];
  statusValue?: string | null;
  onStatusChange?: (status: string | null) => void;
  children?: ReactNode;
}

export default function SalesFilterPanel({
  branches = [],
  branchValue = null,
  onBranchChange,
  statusOptions,
  statusValue = null,
  onStatusChange,
  children,
}: SalesFilterPanelProps) {
  return (
    <TFilterPanel>
      {statusOptions && onStatusChange && (
        <TStatusFilter
          options={statusOptions}
          value={statusValue}
          onChange={onStatusChange}
        />
      )}
      {onBranchChange && (
        <TBranchFilter
          branches={branches}
          value={branchValue}
          onChange={onBranchChange}
        />
      )}
      {children}
    </TFilterPanel>
  );
}
