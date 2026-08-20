import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCursor } from "./cursor.js";

test("decodes a valid cursor payload", () => {
  const cursor = Buffer.from(JSON.stringify({ timestamp: "2026-08-02T11:59:00.000Z", id: 7 })).toString("base64");
  assert.deepEqual(decodeCursor(cursor), { timestamp: "2026-08-02T11:59:00.000Z", id: 7 });
});

test("rejects an invalid cursor payload", () => {
  assert.throws(() => decodeCursor("not-a-valid-cursor"), /invalid cursor/);
});
