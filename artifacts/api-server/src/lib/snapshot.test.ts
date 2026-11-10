import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createSnapshot, SNAPSHOT_REFRESH_MS, TOKEN_CHECK_MS } from "./snapshot.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("first readers share one load, later reads come from memory", async () => {
  let loads = 0;
  const snapshot = createSnapshot("t1", async () => ++loads);
  const [a, b] = await Promise.all([snapshot.get(), snapshot.get()]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  assert.equal(await snapshot.get(), 1);
  assert.equal(loads, 1);
  assert.equal(snapshot.version(), 1);
});

test("an old copy is served at once while a background refresh runs", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  try {
    let loads = 0;
    const snapshot = createSnapshot("t2", async () => ++loads);
    assert.equal(await snapshot.get(), 1);
    mock.timers.tick(SNAPSHOT_REFRESH_MS + 1);
    assert.equal(await snapshot.get(), 1, "stale copy returned without waiting");
    await flush();
    assert.equal(await snapshot.get(), 2, "next read sees the refreshed copy");
    assert.equal(snapshot.version(), 2);
  } finally {
    mock.timers.reset();
  }
});

test("a failed refresh keeps serving the previous copy", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  try {
    let fail = false;
    const snapshot = createSnapshot("t3", async () => {
      if (fail) throw new Error("BigQuery down");
      return "good";
    });
    assert.equal(await snapshot.get(), "good");
    fail = true;
    mock.timers.tick(SNAPSHOT_REFRESH_MS + 1);
    assert.equal(await snapshot.get(), "good");
    await flush();
    assert.equal(await snapshot.get(), "good");
    assert.equal(snapshot.version(), 1);
  } finally {
    mock.timers.reset();
  }
});

test("a failed first load rejects, and the next read tries again", async () => {
  let attempt = 0;
  const snapshot = createSnapshot("t4", async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("BigQuery down");
    return "ok";
  });
  await assert.rejects(snapshot.get());
  assert.equal(await snapshot.get(), "ok");
});

test("a changed token refreshes the copy before the timer; the same or an unreadable token does not", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  try {
    let loads = 0;
    let token: string | null = "run-1";
    let tokenFails = false;
    const snapshot = createSnapshot("t5", async () => ++loads, {
      token: async () => {
        if (tokenFails) throw new Error("db down");
        return token;
      },
    });
    assert.equal(await snapshot.get(), 1);

    mock.timers.tick(TOKEN_CHECK_MS + 1);
    assert.equal(await snapshot.get(), 1);
    await flush();
    assert.equal(loads, 1, "same token: no reload");

    token = "run-2";
    mock.timers.tick(TOKEN_CHECK_MS + 1);
    assert.equal(await snapshot.get(), 1, "the old copy is served while the refresh runs");
    await flush();
    await flush();
    assert.equal(await snapshot.get(), 2, "new token: reloaded long before SNAPSHOT_REFRESH_MS");

    tokenFails = true;
    mock.timers.tick(TOKEN_CHECK_MS + 1);
    await snapshot.get();
    await flush();
    assert.equal(loads, 2, "an unreadable token is ignored");
  } finally {
    mock.timers.reset();
  }
});
