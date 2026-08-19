import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import {
  buildCensus,
  classifyFailureShape,
  classifyLifecyclePosition,
  extractFailingFiles,
  parseDiagnosticsJsonl,
  stripAnsi,
} from "../pg-loaded-failure-census.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/pg-loaded-failure-census/${name}`, import.meta.url), "utf8");

test("strips ANSI and classifies failure lifecycle positions and shapes", () => {
  assert.equal(stripAnsi("\u001b[31mFAIL\u001b[0m"), "FAIL");
  assert.equal(classifyLifecyclePosition("Error: beforeAll hook timed out"), "beforeAll hook");
  assert.equal(classifyLifecyclePosition("Error: afterEach hook failed"), "afterEach");
  assert.equal(classifyLifecyclePosition("global teardown failure"), "global setup-teardown");
  assert.equal(classifyFailureShape("beforeAll hook timed out in 15000ms"), "hook timeout");
  assert.equal(classifyFailureShape("Test timed out in 15000ms"), "test timeout");
  assert.equal(classifyFailureShape("AssertionError: expected 1 to be 2"), "assertion");
});

test("censuses every high-failure file and joins snapshot diagnostics", () => {
  const parsed = parseDiagnosticsJsonl(fixture("high.jsonl"));
  assert.equal(parsed.malformedLines, 1);
  const census = buildCensus({
    log: fixture("high-run.txt"),
    diagnostics: parsed.rows,
    ordinarySlotCeiling: 97,
    subjects: ["src/__tests__/postgres/case-00.test.ts"],
  });
  assert.equal(census.status, "measured");
  assert.equal(census.totalFiles, 176);
  assert.equal(census.failingFileCount, 25);
  assert.equal(census.failingFileBand, "high (>=25)");
  assert.equal(census.peakBackends, 73);
  assert.equal(census.backendHeadroom, 24);
  assert.equal(census.lifecyclePositionHistogram["beforeAll hook"], 5);
  assert.equal(census.failureShapeHistogram["hook timeout"], 1);
  assert.equal(census.failureShapeHistogram["test timeout"], 1);
  assert.equal(census.failureShapeHistogram.assertion, 1);
  assert.equal(census.waitEventHistogram["IPC/CheckpointDone"], 2);
  assert.equal(census.watchdogCount, 2);
  assert.equal(census.probeDegradationCount, 1);
  assert.equal(census.failingFiles[0].campaignSubject, true);
  assert.equal(extractFailingFiles(fixture("high-run.txt")).length, 25);
});

test("reports a complete healthy run as measured zero rather than insufficient data", () => {
  const census = buildCensus({ log: fixture("low-run.txt"), diagnostics: [], ordinarySlotCeiling: 97 });
  assert.equal(census.status, "measured");
  assert.equal(census.failingFileCount, 0);
  assert.equal(census.failingFileBand, "zero");
  assert.equal(census.peakBackends, null);
});

test("rejects a truncated runner log instead of manufacturing a zero-failure census", () => {
  const census = buildCensus({ log: fixture("truncated-run.txt") });
  assert.equal(census.status, "insufficient-data");
  assert.match(census.reason, /missing Test Files summary/);
  assert.notEqual(census.failingFileCount, 0);
});
