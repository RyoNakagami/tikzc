import { useEffect } from "react";

export function useDebouncedEffect(
  effect: () => void | (() => void),
  delayMs: number | null,
  deps: readonly unknown[]
) {
  useEffect(() => {
    if (delayMs == null) {
      return effect();
    }

    const timer = window.setTimeout(() => {
      cleanup = effect();
    }, delayMs);
    let cleanup: void | (() => void);

    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps]);
}
