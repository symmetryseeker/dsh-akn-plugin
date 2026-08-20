# DSH Tool-Call Hot-Path Benchmark — 2026-08-20

Status: **MVP synchronous-I/O requirement passes; complete-Spec whole-workload CPU `<1%` is not yet established**.

## Setup

- Official DeepSeek Harness `0.1.0-rc.7` `SessionStore`, `AgentRegistry` and `SkillRegistry` composition.
- A registered live Agent/session, with and without the AEN Cordis plugin.
- 2,000 warm-up `tool/call` events.
- Five alternating rounds of 20,000 `tool/call` events per runtime.
- No request/configuration boundary is present, so a correct plugin must not schedule a Manifest snapshot.
- Apple M5 engineering machine; Node.js v24.14.1.

This deliberately isolates the event listener and is much smaller than a real tool workload. Its relative percentage is diagnostic, not a valid measurement of total tool execution CPU.

## Results after hot-path optimization

| Runtime | Round times (ms / 20k) | Median | Median/event |
| --- | --- | ---: | ---: |
| DSH baseline | 45.716, 36.426, 37.805, 36.298, 36.661 | 36.661 ms | 1.833 µs |
| DSH + AEN | 53.794, 51.543, 54.621, 51.217, 67.018 | 53.794 ms | 2.690 µs |

- Absolute diagnostic delta: approximately **0.857 µs/event**.
- Diagnostic relative delta against the isolated append baseline: **+46.73%**.
- AEN objects stored after 102,000 ordinary tool calls: **0**.
- Snapshot/configuration I/O scheduled: **0** (also asserted in unit tests).

The listener now returns on `tool/call` and `tool/result` before Agent registry lookup or policy-prefix scanning. Before that change, the same diagnostic run measured a 6.747 µs AEN median/event; the optimized AEN listener reduced its excess over baseline by roughly 83% on this run.

## Interpretation

- `MVP-NFR-001` requires ordinary DSH tool-call synchronous I/O to be zero. The object/snapshot assertions pass.
- Complete-Spec `NFR-001` additionally requires CPU overhead `<1%` in a representative before/after tool workload. This isolated append benchmark cannot establish that claim and its relative microbenchmark delta is above 1%.
- The remaining validation must execute representative real DSH tools (fast local read, process/terminal, network-bound and model-bound cases), measure whole-turn CPU and wall time with sufficient repetitions, and report confidence/variance. The project must not divide the sub-microsecond listener delta by an assumed tool duration and call that measured evidence.

## Reproduction

```sh
pnpm bench:dsh-hot-path
```

Optional load controls:

```sh
AEN_DSH_BENCH_EVENTS=20000 AEN_DSH_BENCH_ROUNDS=5 pnpm bench:dsh-hot-path
```
