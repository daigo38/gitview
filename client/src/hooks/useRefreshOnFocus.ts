import { useEffect, useRef } from 'react';

export function useRefreshOnFocus(
  enabled: boolean,
  refresh: () => void | Promise<void>,
): void {
  const refreshRef = useRef(refresh);
  const needsRefreshRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const markAway = (): void => {
      needsRefreshRef.current = true;
    };

    const refreshIfNeeded = (): void => {
      if (!enabled || !needsRefreshRef.current || document.visibilityState !== 'visible') return;
      needsRefreshRef.current = false;
      void refreshRef.current();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        markAway();
      } else {
        refreshIfNeeded();
      }
    };

    window.addEventListener('blur', markAway);
    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('blur', markAway);
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled]);
}
