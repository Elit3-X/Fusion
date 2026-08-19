---
category: test-failures
module: testing
problem_type: loaded_postgresql_timeout_population
applies_when:
  - "The 27-worker core PostgreSQL directory lane reports unrelated hook or test timeouts"
  - "A PostgreSQL loaded-lane remedy is proposed from runner-log impressions"
tags:
  - postgres
  - vitest
  - diagnostics
  - timeout
  - census
---

# PostgreSQL loaded-lane unrelated failure population

## Verdict: reproduced, but attribution remains coverage-limited

FN-9148 reproduced the unrelated population in three of five pre-registered,
diagnostics-enabled 27-worker directory runs. A03/A04/A05 reported 45, 35, and
32 failed files respectively, while their observed peaks were 63, 75, and 71
backends below the 97 ordinary-slot ceiling. This establishes the fan-out
symptom; it does not establish a cause or authorize a harness remedy.

## Method

`scripts/pg-loaded-failure-census.mjs` is a cluster-free parser. It reads a
retained Vitest runner log and teardown-diagnostics JSONL, then reports every
failing file, its lifecycle position and shape, snapshot peak/headroom, waits,
phase-duration statistics, and watchdog/probe-degradation counts. It labels
campaign subjects rather than excluding them. A missing `Test Files` summary
is `insufficient-data`; a complete passing summary is a measured zero-failure
run.

The host had 28 CPUs, so requested 27 workers resolved to 27. PostgreSQL was
15.15 with `max_connections=100`, three reserved connections, 128MB
`shared_buffers`, a five-minute checkpoint timeout, and 1GB maximum WAL. Test
databases were enumerated and explicitly reset between primary samples.

| lane | outcome |
|---|---|
| 27-worker directory A01–A05 | red: 13, 24, 45, 35, 32 failed files; peaks 73, 61, 63, 75, 71 |
| 12-worker directory | green, measured zero failures |
| isolated `project-identity.test.ts` | green, measured zero failures |
| configured four-fork PG gate | green, measured zero failures |
| default core lane | green, measured zero failures |

The reproduced runs mixed setup/teardown and body timeouts. A03, for example,
had four beforeAll, 19 afterEach, five afterAll, and 17 body failures; its
watchdog snapshots included checkpoint, ProcSignalBarrier, and object-lock
waits. The checkpointed task document `evidence` is the detailed durable
record.

## FN-9149 timeout-boundary observation

FN-9149 added a default-off setup/body/teardown observer and ran its enabled-wiring gate before the campaign. The gate emitted full, non-suppressed watchdog payloads at all three boundaries, including `shared.body`; it used only observer environment settings (1ms per-boundary watchdogs, 1500ms probe timeout, 1200ms statement timeout, 2000ms drain, max probes 20, concurrency 3). The raised cap and concurrency were gate-only; campaign runs retained concurrency 1 and queue timeout 0.

The original I01–I03 samples (14, 31, and 52 failures; peaks 66, 68, and 70) and unset control (27 failures; peak 70) remain retained as superseded: their 12s watchdog was coverage-limited and the original 25% population rule flagged perturbation.

Before any J-series invocation, FN-9149 prospectively amended the registration. FN-9148’s fixed baseline dispersion was 13/24/45/35/32 (range 32, or 71.1% of the 45-file maximum), so the J-only perturbation threshold is conservatively rounded to 72% of the larger population. The fixed amended observer stack used 14s setup/body/teardown watchdogs (strictly below the 15s inherited budgets and above the measured healthy gate maximum), threshold 2s, probe/statement/drain 1500/1400/3000ms, cap 4, concurrency 1, and queue 0. The forced gate’s raised cap/concurrency remained gate-only.

The J-series completed three instrumented runs and an unset-observer control: J01=47 failures, peak 58; J02=26, peak 79; J03=54, peak 67; control=40, peak 70. Their enabled/control differences (7/14/14) are below the prospectively fixed 72% limits (34/29/39), so the J instrumented output is not perturbation-flagged. All peaks remain below the 97 ordinary-slot ceiling. J01/J02/J03 joined 9/2/1 cluster-implicated failures and left 38/24/53 unjoined; no watchdog probe was suppressed and one record per run settled during its probe. This remains insufficient body and boundary coverage for M2–M4 attribution, not evidence for a remedy. Full JSONL/census and the retained prior sample are checkpointed in FN-9149’s `evidence` document.

The superseded 12s clean/dirty arm remains retained but cannot decide M5. The required amended-stack arm then ran interleaved `clean → dirty → clean → dirty` as J04–J07. Clean J04/J06 began with zero matching leftovers and reported 29/36 failures (peaks 79/68; cluster/unjoined=0/29 and 3/33). Dirty J05/J07 deliberately retained one `fusion_test_%`, two `fusion_schema_template%` databases (including a live-owner golden template), and one `fusion_pool_%` database; they reported 43/50 failures (peaks 88/65; cluster/unjoined=6/37 and 2/48). All four used the fixed J observer stack and were retained; J05's 13 `cap` suppressions limit boundary attribution but do not erase the independently repeated clean/dirty failure-count covariation. The monotonic watchdog-drift host sample was nonzero on 4/4, 114/130, 19/20, and 26/28 watchdog records respectively (max 3/18/10/4ms), so this arm does not support host-starvation attribution. Final cluster hygiene was restored to zero matching test, pool, and schema-template databases.

## Discrimination table

| mechanism | verdict | evidence / missing discriminator |
|---|---|---|
| M1 ordinary backend exhaustion | eliminated (generic ordinary-slot form) | A01–A05 and J01–J03 peaks were 58–79, all below the 97 ordinary ceiling; no per-user/database limit was observed. A successor must separately measure any scoped limit before claiming that variant. |
| M2 DDL serialization | still undecided (missing evidence: join coverage) | Twelve J watchdog joins cannot correlate DDL/locks to 127 failures. |
| M3 golden-template/advisory convoy | still undecided (missing evidence: joined golden-lock waiters) | The probe now records granted holders and non-granted golden advisory waiters; no sufficient joined timeout population exists. |
| M4 host CPU/event-loop starvation | still undecided (missing evidence: join coverage) | The observer now records watchdog scheduling drift rather than a fixed zero, but the campaign cannot distinguish idle-cluster host starvation from blocked SQL at required body coverage. |
| M5 dirty-cluster carryover | affirmed | The amended interleaved J04–J07 arm covaried at 0 leftovers → 29/36 failures and 1 test + 2 schema-template (one golden) + 1 pool leftover → 43/50 failures. FN-9151 owns identification and a regression-proven structural remedy; no remedy is implemented here. |

## Remedies disqualified by this evidence

Do not raise timeouts, add retries or skips, alter worker caps, quarantine core
PostgreSQL files, wire the retained connection-budget/admission primitives, or
change DDL paths. Reducing generic connection demand is specifically unsupported:
the reproduced peaks are below ordinary capacity. A green comparison lane is
not a resolution.

## Successor measurement seam

FN-9151 owns the affirmed dirty-carryover structural seam: identify why retained `fusion_test_%`, `fusion_schema_template%` (including golden), and `fusion_pool_%` state covaries with the 27-worker failure population, then prove a remedy with a regression without changing timeouts, retries, skips, worker caps, quarantine, DDL, connection-budget, or admission behavior. A separate successor may improve timeout-boundary join coverage for M2–M4; it must preserve the default-off observer and repeat the perturbation control. Generic ordinary-slot exhaustion remains disqualified.
