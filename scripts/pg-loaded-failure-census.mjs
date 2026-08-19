#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/*
FNXC:PgLoadedFailureCensus 2026-08-19-12:41:
FN-9148 requires a report-only census because earlier PostgreSQL loaded-lane
owners had to reason from runner-log impressions. Peaks of 62–73 below 97
ordinary slots already contradict ordinary connection exhaustion, while a
non-reproducing run is evidence only when it remains distinguishable from a
missing or truncated capture. This parser never opens PostgreSQL, runs tests,
or changes harness behavior.
*/

export function stripAnsi(text) {
  return String(text).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

export function parseDiagnosticsJsonl(text) {
  const rows = [];
  let malformedLines = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row);
      else malformedLines += 1;
    } catch {
      malformedLines += 1;
    }
  }
  return { rows, malformedLines };
}

function normalizeFile(value) {
  const match = String(value).replaceAll("\\", "/").match(/(?:[\w@.-]+\/)*[\w@.-]+(?:\.pg)?\.test\.[cm]?[jt]sx?/i);
  return match?.[0] ?? null;
}

export function classifyLifecyclePosition(text) {
  const value = String(text).toLowerCase();
  if (/\bglobal (?:setup|teardown)\b|\bglobalSetup\b|\bglobalTeardown\b/i.test(text)) return "global setup-teardown";
  if (/\bafterall\b|\bafter all\b/i.test(text)) return "afterAll hook";
  if (/\baftereach\b|\bafter each\b/i.test(text)) return "afterEach";
  if (/\bbeforeall\b|\bbefore all\b/i.test(text)) return "beforeAll hook";
  if (/\bbeforeeach\b|\bbefore each\b|\bin-test setup\b|\btest setup\b/i.test(text)) return "in-test setup";
  return "test body";
}

export function classifyFailureShape(text) {
  const value = String(text).toLowerCase();
  if (/\b(?:hook|beforeall|beforeeach|afterall|aftereach|global setup|global teardown)\b[\s\S]{0,120}\btimed out\b|\btimed out\b[\s\S]{0,120}\b(?:hook|beforeall|beforeeach|afterall|aftereach)\b/.test(value)) return "hook timeout";
  if (/\btest timed out\b|\btimed out\b/.test(value)) return "test timeout";
  if (/assertionerror|\bexpected\b[\s\S]{0,80}\b(?:to be|to equal|to deeply equal|received)\b/i.test(text)) return "assertion";
  return "error";
}

export function extractFailingFiles(log) {
  const clean = stripAnsi(log);
  const headings = [...clean.matchAll(/^\s*(?:FAIL|❯)\s+(.+?\.test\.[cm]?[jt]sx?)(?:\s|$)/gim)];
  const failures = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const file = normalizeFile(headings[index][1]);
    if (!file) continue;
    const start = headings[index].index ?? 0;
    const end = headings[index + 1]?.index ?? clean.length;
    const detail = clean.slice(start, end);
    const prior = failures.get(file);
    if (!prior || detail.length > prior.detail.length) {
      failures.set(file, { file, lifecyclePosition: classifyLifecyclePosition(detail), failureShape: classifyFailureShape(detail), detail });
    }
  }
  return [...failures.values()].map(({ detail: _detail, ...failure }) => failure);
}

function parseCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseFileSummary(log) {
  const line = stripAnsi(log).split(/\r?\n/).find((candidate) => /^\s*Test Files\s+/i.test(candidate));
  if (!line) return { complete: false, totalFiles: null, reportedFailedFiles: null };
  const count = (word) => {
    const match = line.match(new RegExp(`(\\d+)\\s+${word}\\b`, "i"));
    return match ? parseCount(match[1]) : 0;
  };
  const failed = count("failed");
  const passed = count("passed");
  const skipped = count("skipped");
  if ([failed, passed, skipped].some((value) => value == null)) return { complete: false, totalFiles: null, reportedFailedFiles: null };
  return { complete: true, totalFiles: failed + passed + skipped, reportedFailedFiles: failed };
}

export function summarizeDiagnostics(diagnostics) {
  const input = Array.isArray(diagnostics) ? diagnostics : [];
  const waits = new Map();
  const peaks = [];
  const phaseDurations = new Map();
  let watchdogCount = 0;
  let probeDegradationCount = 0;
  for (const row of input) {
    if (row?.trigger === "phase-watchdog" || row?.trigger === "teardown-watchdog") watchdogCount += 1;
    if (row?.probeSuppressed || (row?.trigger?.includes("watchdog") && row?.probeRan === false)) probeDegradationCount += 1;
    for (const duration of Object.values(row?.phaseDurationsMs ?? {})) {
      if (Number.isFinite(duration)) phaseDurations.set("all", [...(phaseDurations.get("all") ?? []), duration]);
    }
    for (const activity of row?.snapshotRows ?? []) {
      if (Number.isFinite(activity?.total_backends)) peaks.push(activity.total_backends);
      const type = activity?.wait_event_type ?? "none";
      const event = activity?.wait_event ?? "none";
      const key = `${type}/${event}`;
      waits.set(key, (waits.get(key) ?? 0) + 1);
    }
  }
  const values = phaseDurations.get("all") ?? [];
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (fraction) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return {
    peakBackends: peaks.length ? Math.max(...peaks) : null,
    waitEventHistogram: Object.fromEntries([...waits.entries()].sort(([a], [b]) => a.localeCompare(b))),
    phaseDurationMs: { count: sorted.length, median: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null },
    watchdogCount,
    probeDegradationCount,
  };
}

export function buildCensus({ log, diagnostics = [], ordinarySlotCeiling = null, subjects = [] }) {
  const summary = parseFileSummary(log);
  if (!summary.complete) {
    return { status: "insufficient-data", reason: "missing Test Files summary", totalFiles: null, failingFiles: [], failingFileCount: null };
  }
  const failingFiles = extractFailingFiles(log).map((failure) => ({ ...failure, campaignSubject: subjects.includes(failure.file) }));
  if (summary.reportedFailedFiles !== failingFiles.length) {
    return { status: "insufficient-data", reason: `summary reports ${summary.reportedFailedFiles} failed files but ${failingFiles.length} failure blocks were parsed`, totalFiles: summary.totalFiles, failingFiles, failingFileCount: null };
  }
  const diagnosticSummary = summarizeDiagnostics(diagnostics);
  const ceiling = Number.isFinite(ordinarySlotCeiling) && ordinarySlotCeiling >= 0 ? ordinarySlotCeiling : null;
  return {
    status: "measured",
    totalFiles: summary.totalFiles,
    failingFiles,
    failingFileCount: failingFiles.length,
    failingFileBand: failingFiles.length >= 25 ? "high (>=25)" : failingFiles.length === 0 ? "zero" : "low (1-24)",
    lifecyclePositionHistogram: Object.fromEntries(Object.entries(Object.groupBy(failingFiles, (failure) => failure.lifecyclePosition)).map(([key, values]) => [key, values.length])),
    failureShapeHistogram: Object.fromEntries(Object.entries(Object.groupBy(failingFiles, (failure) => failure.failureShape)).map(([key, values]) => [key, values.length])),
    ordinarySlotCeiling: ceiling,
    backendHeadroom: ceiling != null && diagnosticSummary.peakBackends != null ? ceiling - diagnosticSummary.peakBackends : null,
    ...diagnosticSummary,
  };
}

function parseArgs(args) {
  const result = { log: undefined, diagnostics: undefined, ordinarySlotCeiling: null, subjects: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--log") result.log = args[++index];
    else if (argument === "--diagnostics") result.diagnostics = args[++index];
    else if (argument === "--ordinary-slot-ceiling") result.ordinarySlotCeiling = Number(args[++index]);
    else if (argument === "--subject") result.subjects.push(args[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.log) throw new Error("Supply --log <runner.log>");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const parsed = args.diagnostics ? parseDiagnosticsJsonl(readFileSync(args.diagnostics, "utf8")) : { rows: [], malformedLines: 0 };
  console.log(JSON.stringify({ ...buildCensus({ log: readFileSync(args.log, "utf8"), diagnostics: parsed.rows, ordinarySlotCeiling: args.ordinarySlotCeiling, subjects: args.subjects }), malformedDiagnosticLines: parsed.malformedLines }, null, 2));
}
