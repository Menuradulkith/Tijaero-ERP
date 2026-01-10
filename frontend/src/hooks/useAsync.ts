import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseAsyncOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseAsyncResult<T, Args extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for handling async operations with loading and error states
 */
export function useAsync<T, Args extends unknown[] = []>(
  asyncFunction: (...args: Args) => Promise<T>,
  options: UseAsyncOptions<T> = {}
): UseAsyncResult<T, Args> {
  const { immediate = false, onSuccess, onError } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<Error | null>(null);

  const isMounted = useRef(true);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await asyncFunction(...args);
        
        if (isMounted.current) {
          setData(result);
          onSuccess?.(result);
        }
        
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        
        if (isMounted.current) {
          setError(error);
          onError?.(error);
        }
        
        return null;
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    },
    [asyncFunction, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    isMounted.current = true;

    if (immediate) {
      execute(...([] as unknown as Args));
    }

    return () => {
      isMounted.current = false;
    };
  }, []);

  return { data, loading, error, execute, reset };
}
