import { useEffect, useRef } from 'react';

/**
 * Hook for setting the document title
 * @param title - The title to set
 * @param restoreOnUnmount - Whether to restore the previous title on unmount
 */
export function useDocumentTitle(title: string, restoreOnUnmount: boolean = true): void {
  const previousTitle = useRef<string>(document.title);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const prevTitle = previousTitle.current;

    return () => {
      if (restoreOnUnmount) {
        document.title = prevTitle;
      }
    };
  }, [restoreOnUnmount]);
}
