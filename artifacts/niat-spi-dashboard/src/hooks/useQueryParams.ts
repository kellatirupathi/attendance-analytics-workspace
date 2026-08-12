import { useMemo } from "react";
import { useSearch } from "wouter";

/**
 * Reactive access to the URL query string.
 *
 * Do NOT read `window.location.search` inside a `useMemo` keyed on
 * `useLocation()` — wouter's location is the pathname only, so navigating
 * from `/x` to `/x?a=1` does not change it and the memo never recomputes.
 * `useSearch` subscribes to the query string itself, so this updates.
 */
export function useQueryParams(): URLSearchParams {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}
