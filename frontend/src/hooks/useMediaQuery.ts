import { useState, useEffect } from 'react';

/**
 * Hook for responsive design using media queries
 * @param query - CSS media query string
 * @returns Whether the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = (query: string): boolean => {
    // Prevent SSR issues
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState<boolean>(getMatches(query));

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    
    const handleChange = () => {
      setMatches(getMatches(query));
    };

    // Initial check
    handleChange();

    // Listen for changes
    // Use addEventListener for modern browsers
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', handleChange);
      return () => mediaQueryList.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQueryList.addListener(handleChange);
      return () => mediaQueryList.removeListener(handleChange);
    }
  }, [query]);

  return matches;
}

// Convenience hooks for common breakpoints
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 640px) and (max-width: 1023px)');
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useIsDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}
