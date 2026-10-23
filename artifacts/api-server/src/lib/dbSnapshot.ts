/**
 * A small table read from PostgreSQL and kept in memory: re-read at most once per reloadMs, so an
 * edit in the database reaches the app within that time. One load at a time; if a load fails the
 * last good copy is kept (or `empty` when there is none) and the next call tries again.
 */
export interface Snapshot<T> {
  value: T;
  /** Changes whenever the data changes; part of cache keys. */
  version: string;
}

export function dbSnapshot<T>(
  label: string,
  load: () => Promise<Snapshot<T>>,
  empty: Snapshot<T>,
  reloadMs = 60 * 1000,
): () => Promise<Snapshot<T>> {
  let cached: { loadedAt: number; snap: Snapshot<T> } | null = null;
  let loading: Promise<Snapshot<T>> | null = null;
  return async () => {
    if (cached && Date.now() - cached.loadedAt < reloadMs) return cached.snap;
    loading ??= load()
      .then((snap) => {
        cached = { loadedAt: Date.now(), snap };
        return snap;
      })
      .catch((err) => {
        console.error(`[${label}] could not read from the database; keeping the last good copy`, err);
        return cached?.snap ?? empty;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}

/** Version string from row count and the newest updated_at. */
export function rowsVersion(prefix: string, rows: { updatedAt: Date | null }[]): string {
  const latest = rows.reduce((max, r) => Math.max(max, r.updatedAt?.getTime() ?? 0), 0);
  return `${prefix}:${rows.length}:${latest}`;
}
