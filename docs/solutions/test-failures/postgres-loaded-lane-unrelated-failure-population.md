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

## Verdict: reproduced but unattributed

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

## Discrimination table

| mechanism | verdict | evidence / missing discriminator |
|---|---|---|
| M1 ordinary backend exhaustion | undecided; generic version contradicted | Peaks stay 22–36 below 97, but watchdog-only snapshots cannot rule out a per-user/per-database limit or a missed transient peak. |
| M2 DDL serialization | undecided | Hook concentration and checkpoint/catalog/object waits are observations, not per-failed-hook DDL correlation. |
| M3 golden-template/advisory convoy | undecided | No template-owner/lock-wait timeline was captured. |
| M4 host CPU/event-loop starvation | undecided | Host load was material, but teardown-only probes cannot show PostgreSQL idle versus in-flight at setup/body timeout time. |
| M5 dirty-cluster carryover | undecided | Clean resets still reproduced, but no controlled clean/dirty covariation measurement was run. |

## Remedies disqualified by this evidence

Do not raise timeouts, add retries or skips, alter worker caps, quarantine core
PostgreSQL files, wire the retained connection-budget/admission primitives, or
change DDL paths. Reducing generic connection demand is specifically unsupported:
the reproduced peaks are below ordinary capacity. A green comparison lane is
not a resolution.

## Successor measurement seam

The successor must design a separately reviewed, default-off observer that can
join a setup/body or teardown timeout to host pressure, the active SQL/lock
state, and template ownership without changing harness execution. It must run
three instrumented reproductions and an unset-environment control before
attribution. A controlled dirty-cluster arm is also required for M5. Reuse the
census tool and retain all logs/JSONL; do not return to impression-based claims.
