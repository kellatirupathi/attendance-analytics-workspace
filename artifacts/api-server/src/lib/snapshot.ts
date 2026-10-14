import { logger } from "./logger.js";

/** How often shared snapshots re-read BigQuery. Dashboard numbers can be this old. */
export const SNAPSHOT_REFRESH_MS = 30 * 60 * 1000;

export interface Snapshot<T> {
  /**
   * The latest copy. Returns at once when one is held, even an old one (a
   * refresh then runs in the background); waits only before the first load.
   */
  get(): Promise<T>;
  /** Changes on every successful refresh; put it in cache keys built from this data. */
  version(): number;
  /** Load now and refresh every SNAPSHOT_REFRESH_MS from then on. */
  start(): void;
}

const all: Snapshot<unknown>[] = [];

/**
 * One copy of a heavy BigQuery result, shared by every user and refreshed in
 * the background, so requests read memory instead of waiting for BigQuery.
 * BigQuery access is read-only, so the backend keeps the copy itself.
 * A failed refresh keeps serving the previous copy and tries again next time.
 */
export function createSnapshot<T>(name: string, load: () => Promise<T>): Snapshot<T> {
  let value: { data: T; loadedAt: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let version = 0;
  let timer: NodeJS.Timeout | null = null;

  const refresh = (): Promise<T> => {
    if (inFlight) return inFlight;
    const startedAt = Date.now();
    inFlight = load()
      .then((data) => {
        value = { data, loadedAt: Date.now() };
        version += 1;
        logger.info({ snapshot: name, ms: Date.now() - startedAt, version }, "Snapshot refreshed");
        return data;
      })
      .catch((err: unknown) => {
        logger.error({ err, snapshot: name }, "Snapshot refresh failed");
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const snapshot: Snapshot<T> = {
    get() {
      if (!value) return refresh();
      if (Date.now() - value.loadedAt > SNAPSHOT_REFRESH_MS) refresh().catch(() => undefined);
      return Promise.resolve(value.data);
    },
    version: () => version,
    start() {
      if (timer) return;
      refresh().catch(() => undefined);
      timer = setInterval(() => refresh().catch(() => undefined), SNAPSHOT_REFRESH_MS);
      timer.unref();
    },
  };
  all.push(snapshot as Snapshot<unknown>);
  return snapshot;
}

/** Warm every snapshot at server start, then keep them refreshed. */
export function startSnapshots(): void {
  for (const snapshot of all) snapshot.start();
}
