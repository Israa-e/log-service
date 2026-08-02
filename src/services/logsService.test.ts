import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLogEntry } from "./logsService.js";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");

const base = {
  timestamp: "2026-08-02T11:59:00.000Z",
  level: "info",
  service: "checkout",
  message: "payment declined",
};

test("accepts a valid entry", () => {
  const result = validateLogEntry(base, NOW);
  assert.equal(result.valid, true);
});

test("rejects a missing timestamp", () => {
  const result = validateLogEntry({ ...base, timestamp: "" }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /timestamp is required/);
});

test("rejects an unparseable timestamp", () => {
  const result = validateLogEntry({ ...base, timestamp: "not-a-date" }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /invalid timestamp/);
});

test("rejects a timestamp more than 5 minutes in the future", () => {
  const future = new Date(NOW + 6 * 60 * 1000).toISOString();
  const result = validateLogEntry({ ...base, timestamp: future }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /too far in the future/);
});

test("accepts a timestamp exactly at the 5 minute boundary", () => {
  const future = new Date(NOW + 5 * 60 * 1000).toISOString();
  const result = validateLogEntry({ ...base, timestamp: future }, NOW);
  assert.equal(result.valid, true);
});

test("rejects an invalid level", () => {
  const result = validateLogEntry({ ...base, level: "critical" }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /invalid level: 'critical'/);
});

test("rejects an empty service", () => {
  const result = validateLogEntry({ ...base, service: "  " }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /service is required/);
});

test("rejects an empty message", () => {
  const result = validateLogEntry({ ...base, message: "" }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /message is required/);
});

test("accepts flat string/number/boolean attributes", () => {
  const result = validateLogEntry(
    { ...base, attributes: { user_id: "42", retries: 3, resolved: false } },
    NOW
  );
  assert.equal(result.valid, true);
});

test("rejects a nested object attribute", () => {
  const result = validateLogEntry(
    { ...base, attributes: { user: { id: "42" } } as any },
    NOW
  );
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /nested object in attribute 'user'/);
});

test("rejects an array attribute", () => {
  const result = validateLogEntry({ ...base, attributes: { tags: ["a", "b"] } as any }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /nested object in attribute 'tags'/);
});

test("rejects a null entry instead of throwing", () => {
  const result = validateLogEntry(null as any, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /entry must be an object/);
});

test("rejects attributes that are an array, not a flat object", () => {
  const result = validateLogEntry({ ...base, attributes: [1, 2, 3] as any }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /attributes must be a flat object/);
});

test("rejects attributes that are a string", () => {
  const result = validateLogEntry({ ...base, attributes: "hello" as any }, NOW);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /attributes must be a flat object/);
});
