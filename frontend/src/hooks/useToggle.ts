import { useState, useCallback } from 'react';

type ToggleValue = boolean;
type ToggleActions = {
  toggle: () => void;
  setTrue: () => void;
  setFalse: () => void;
  setValue: (value: boolean) => void;
};

/**
 * Hook for boolean toggle state
 * @param initialValue - Initial boolean value (default: false)
 * @returns Tuple of [value, actions]
 */
export function useToggle(initialValue: boolean = false): [ToggleValue, ToggleActions] {
  const [value, setValue] = useState<boolean>(initialValue);

  const toggle = useCallback(() => {
    setValue((prev) => !prev);
  }, []);

  const setTrue = useCallback(() => {
    setValue(true);
  }, []);

  const setFalse = useCallback(() => {
    setValue(false);
  }, []);

  return [
    value,
    {
      toggle,
      setTrue,
      setFalse,
      setValue,
    },
  ];
}
