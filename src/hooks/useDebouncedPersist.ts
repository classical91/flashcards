import { useEffect, useRef } from "react";
import { safeSetItem } from "../lib/storage";

const serialize = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * Persists `value` to localStorage, debounced so that rapid changes (e.g.
 * editing cards or marking progress) collapse into a single write instead of
 * one write per change. Non-string values are JSON-serialized inside the
 * debounced write, keeping large stringify work off the render path; change
 * detection is by reference, so pass a new object only when content changed.
 *
 * Pending writes are flushed immediately when the page is hidden (`pagehide`
 * or `visibilitychange`) or when the component unmounts, so debouncing never
 * costs data on close or navigation.
 */
export function useDebouncedPersist(key: string, value: unknown, delay = 400) {
  const latestRef = useRef(value);
  latestRef.current = value;
  const savedRef = useRef<unknown>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      safeSetItem(key, serialize(value));
      savedRef.current = value;
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, value, delay]);

  useEffect(() => {
    const flush = () => {
      if (savedRef.current !== latestRef.current) {
        safeSetItem(key, serialize(latestRef.current));
        savedRef.current = latestRef.current;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [key]);
}
