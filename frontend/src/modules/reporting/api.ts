import apiClient from "@/api/client";
import * as types from "./types";

// Reports themselves live in the Report Center (center-api.ts). This file only serves
// the branch summary page.
export const reportingApi = {
  getBranchList: async (): Promise<types.BranchOption[]> => {
    const response = await apiClient.get<types.BranchOption[]>("/reporting/branches");
    return response.data;
  },

  getBranchDailySummary: async (
    startDate: string,
    endDate: string,
    branchCodes?: string[]
  ): Promise<types.BranchDailySummary[]> => {
    const params: Record<string, string> = { start_date: startDate, end_date: endDate };
    if (branchCodes && branchCodes.length > 0) {
      params.branch_codes = branchCodes.join(",");
    }
    const response = await apiClient.get<types.BranchDailySummary[]>(
      "/reporting/branch-summary",
      { params }
    );
    return response.data;
  },
};
