# AEN MVP Search Performance Smoke Report — 2026-08-20

Status: **pass for MVP-NFR-002 on the declared machine and load only**.

This is a synthetic, deterministic load-shape benchmark. It does not prove product utility, production availability, multi-tenant behavior, or the complete-Spec capacity target of 100k Experiences / 1M Observations.

## Environment

| Item | Value |
| --- | --- |
| Platform | macOS Darwin 25.5.0 |
| CPU | Apple M5, 10 logical CPUs |
| Memory | 32 GiB |
| Node.js | v24.14.1 |
| PostgreSQL | 17 |
| Experience rows | 1,000 |
| Observation rows | 0 |
| Concurrency | 1 |
| Warm-up | 20 requests per surface |
| Result budget | 3 cards |
| Query | deterministic recovery, exact Model × Harness plus policy filters |

The generated objects contain synthetic H1 claims, metrics, negative-transfer signals, task families, Model selectors, a stable Harness configuration digest selector, license and risk metadata. They are explicitly labeled as synthetic and are not evaluation evidence.

## Results

| Surface | Samples | Min | p50 | p95 | p99 | Max | Objective | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Local SQLite search | 200 | 2.688 ms | 2.846 ms | **3.110 ms** | 3.496 ms | 3.635 ms | p95 <100 ms | Pass |
| Hub PostgreSQL 17 + loopback HTTP first cards | 100 | 20.373 ms | 20.582 ms | **20.923 ms** | 21.582 ms | 23.600 ms | p95 <800 ms | Pass |

The Hub measurement includes HTTP parsing/serialization, PostgreSQL FTS and policy filters, the shared deterministic reranker, and a three-card response. Dataset construction, database rebuild, and cold startup are outside the request-latency sample.

## Reproduction

```sh
pnpm bench:performance
```

Optional environment variables change the declared load:

```sh
AEN_BENCH_DATASET_SIZE=1000 \
AEN_BENCH_LOCAL_SAMPLES=200 \
AEN_BENCH_HUB_SAMPLES=100 \
AEN_BENCH_WARMUP_SAMPLES=20 \
pnpm bench:performance
```

The benchmark starts an isolated native PostgreSQL process on loopback, closes all stores/processes, and deletes only its validated temporary directory.

## Evidence boundary and remaining work

- This satisfies `MVP-NFR-002` for the precise hardware/load above.
- It does not satisfy complete-Spec `NFR-003` (30-day production SLI), `NFR-005` (100k/1M capacity), or multi-concurrency production sizing.
- `MVP-NFR-001` synchronous tool-call I/O is covered by DSH plugin event-path tests; complete-Spec CPU overhead `<1%` still needs a before/after benchmark inside a representative real DSH tool workload rather than an isolated listener microbenchmark.
- Production sizing must add multiple dataset sizes, object-size distributions, concurrent clients, observation-heavy projections, cold-cache behavior, write/rebuild contention, and resource saturation data.
