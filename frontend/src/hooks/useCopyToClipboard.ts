import { useCallback, useState } from 'react';

interface UseCopyToClipboardResult {
  copied: boolean;
  error: Error | null;
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
}

/**
 * Hook for copying text to clipboard
 * @param resetDelay - Auto-reset copied state after delay (ms). Set to 0 to disable.
 * @returns Object with copied state and copy function
 */
export function useCopyToClipboard(resetDelay: number = 2000): UseCopyToClipboardResult {
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!navigator?.clipboard) {
        const error = new Error('Clipboard API not available');
        setError(error);
        return false;
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setError(null);

        if (resetDelay > 0) {
          setTimeout(() => {
            setCopied(false);
          }, resetDelay);
        }

        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to copy to clipboard');
        setError(error);
        setCopied(false);
        return false;
      }
    },
    [resetDelay]
  );

  const reset = useCallback(() => {
    setCopied(false);
    setError(null);
  }, []);

  return { copied, error, copy, reset };
}
