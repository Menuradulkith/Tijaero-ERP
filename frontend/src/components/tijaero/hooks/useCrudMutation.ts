import { handleApiError } from "@/utils/errorHandling";
import {
  type MutationFunction,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { showErrorToast, showSuccessToast } from "../feedback-extended";

type CrudMutationConfig<TData, TVariables, TContext> = {
  mutationFn: MutationFunction<TData, TVariables>;
  invalidateQueryKeys?: QueryKey[];
  getInvalidateQueryKeys?: (data: TData, variables: TVariables) => QueryKey[];
  successMessage?: string;
  getSuccessMessage?: (data: TData, variables: TVariables) => string | undefined;
  errorMessage: string;
  showSuccess?: boolean;
  showError?: boolean;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
  onError?: (error: unknown, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
};

export function useCrudMutation<TData = unknown, TVariables = void, TContext = unknown>(
  config: CrudMutationConfig<TData, TVariables, TContext>,
) {
  const queryClient = useQueryClient();

  return useMutation<TData, unknown, TVariables, TContext>({
    mutationFn: config.mutationFn,
    onSuccess: async (data, variables, context) => {
      const dynamicKeys = config.getInvalidateQueryKeys?.(data, variables) ?? [];
      const queryKeys = [...(config.invalidateQueryKeys ?? []), ...dynamicKeys];

      if (queryKeys.length > 0) {
        await Promise.all(
          queryKeys.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        );
      }

      if (config.showSuccess !== false) {
        const successMessage =
          config.getSuccessMessage?.(data, variables) ?? config.successMessage;
        if (successMessage) {
          showSuccessToast(successMessage);
        }
      }

      await config.onSuccess?.(data, variables, context);
    },
    onError: async (error, variables, context) => {
      if (config.showError !== false) {
        showErrorToast(handleApiError(error, config.errorMessage));
      }
      await config.onError?.(error, variables, context);
    },
  });
}

export default useCrudMutation;
