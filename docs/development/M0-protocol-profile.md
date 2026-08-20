# Capability：M0 AEXP MVP Protocol Profile

状态：Draft/Pilot implementation，等待后续里程碑集成验证。

## Requirements

- MVP-FR-003：ModelFingerprint + HarnessManifest + Environment 形成 Configuration Cell。
- MVP-SEC-002：公共对象进入索引前可验证 Schema、digest 与 DSSE。
- MVP-SEC-004：协议入口具有 byte/depth/item limits。
- MVP-GOV-001：协议和 conformance 不依赖官方云。
- AEXP 0.1：Model/Harness/Environment 身份、验证顺序、签名不等于真实性、开放验证和 required-capability fail-closed 语义。

## In scope

- 19 类可持久化 AEXP Protocol Object；
- 2 类 API payload/projection；
- TypeBox 单一类型/Schema 定义源；
- JSON Schema 2020-12；
- RFC 8785 JCS + SHA-256；
- in-toto Statement v1 + DSSE Ed25519；
- published 与 pre-digest 两阶段验证；
- required capability fail-closed；
- valid/invalid/golden conformance fixtures；
- `aen validate` 和 `aen conformance run`。

## Out of scope

- DSH Trace/Manifest Adapter（M1）；
- SQLite Local Evidence Store（M1）；
- Public Promotion policy、secret/license scanners（M4）；
- Hub key authorization、revocation projection 和远程更新基础设施（M4/后续 Profile）；
- federation、OCI artifact distribution、learned ranking。

## Acceptance tests first

- 19 类对象全部 Schema/digest round-trip；
- 每类对象的 digest mismatch 都被拒绝；
- unknown optional data 被原样保留；
- unknown required capability fail-closed；
- pre-digest 校验不等同于 published 校验；
- canonical digest 不受 key insertion order 影响，且只排除顶层签名字段；
- DSSE 正确签名通过，payload/issuer/subject digest 篡改失败；
- 非 JSON、循环、过深和超限输入在入口被拒绝。

## Implementation surfaces

- `packages/protocol/src/components.ts`
- `packages/protocol/src/schemas.ts`
- `packages/protocol/src/digest.ts`
- `packages/protocol/src/validation.ts`
- `packages/protocol/src/attestation.ts`
- `schemas/aexp/0.1/`
- `conformance/`
- `apps/cli/src/main.ts`

## Spec correction

开发前审计发现早期设计稿中的 Protocol Object 身份和摘要生命周期互相矛盾，已通过 [ADR-0001](../adr/0001-protocol-object-identity.md) 固化为当前 AEXP 0.1 Schema、规范与 MVP Profile。修正保持核心项目语义不变：稳定对象身份服务于跨开发者的 Model + Harness 经验交换，而不是创建新的 MVP-only wire object。

## Evidence

```text
pnpm typecheck
  protocol + CLI TypeScript checks pass

pnpm test
  protocol test suite passes

pnpm conformance
  19 valid fixtures, 21 invalid fixtures, 19 golden digests, 0 failures

pnpm build
  protocol + CLI build pass

pnpm schemas:generate (twice)
  generated artifact checksums are identical
```

## Remaining risks

- M0 只证明对象、完整性与签名原语；尚未证明 DSH 能提供足够的 declared/effective Harness evidence。
- Schema 允许未来 optional 顶层字段以保持 minor-version forwards compatibility；安全关键新语义必须通过 `requiredCapabilities` 声明。
- Ed25519 key authorization、publisher registry 和 key revocation 属于 Public Hub ingress，不能由“签名数学有效”替代。
- Public H2/H3 policy 仍需在 M2–M4 实现；Schema 通过不代表 claim 正确或可公开。
