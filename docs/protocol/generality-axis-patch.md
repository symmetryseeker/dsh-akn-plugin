# AEN generality 轴协议 patch — 把"共进化指导自进化"固化为协议

> 状态: 已实现（本 patch）
> 关联思想: 人类"预训练/社会化知识"层（通用经验） vs "岗位技能"层（专属经验）；
> harness 自进化中有一部分是**共进化**，共进化指导自进化。

## 1. 动机

AEN 已用 **Configuration Cell（Model × Harness × Env）** 区分经验适用的**场景**，但协议缺少一个轴来表达经验的**可迁移度**（通用 vs 专属）。没有这个轴，检索/排序无法体现"通用经验优先注入"——共进化指导自进化的机制就停留在文档口号，而非协议事实。

## 2. 改动清单

### 2.1 协议字段（`packages/protocol/src/components.ts`）

`ApplicabilitySchema` 新增（**Optional，不扰动既有对象 digest**）：

```ts
export const GeneralitySchema = Type.Optional(
  Type.Union(['universal', 'domain', 'scene_specific'].map((v) => Type.Literal(v))),
)
export type Generality = Static<typeof GeneralitySchema>
// ApplicabilitySchema.generality: GeneralitySchema
export type Applicability = Static<typeof ApplicabilitySchema>
```

语义（**派生不声明**）：
| 值 | 含义 | 应支持的证据 |
|---|---|---|
| `universal` | 跨任务族/跨场景可迁移 | 跨任务族 transfer 评测（H3） |
| `domain` | 领域内可迁移 | 同领域多任务复用 |
| `scene_specific` | 绑定具体场景 | Configuration Cell 内成立 |
| 缺省 | 未测量 | — |

- `universal` **应由 transfer 评测证据支持，而非作者自报**；ranking 只对已声明值加权，不替作者声称。
- Optional 字段 ⇒ `valueFromSchema` 不填 ⇒ valid fixture digest 不变（已用 `pnpm schemas:generate` + conformance 验证：19 golden 全过）。

### 2.2 排序（`packages/protocol/src/mvp-ranking.ts`）

- 新增 `GENERALITY = { scene_specific:1, domain:2, universal:3 }`。
- score 加 `generalityRank * 10`（权重低于 compatibility 的 100，高于 freshness），并进 scoreExplanation。
- **作用**：搜索时 universal 经验优先注入 Context Plan——"共进化指导自进化"的机制落地。

### 2.3 Hub 投影（`packages/hub/src/postgres.ts` + `types.ts`）

- `hub_experiences` 加 `generality text` + `generality_rank integer`（含 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 兼容既有部署）。
- ingest 时从 `applicability.generality` 提取。
- `HubSearchQuery.minGenerality` 过滤 + SQL 候选预排序加 `generality_rank DESC`。

### 2.4 本地检索（`packages/local-store/src/retrieval.ts`）

- 经共享 `selectMvpExperienceCandidates` 自动获得 generality 加权（card 的 scoreExplanation 带出）。

### 2.5 生产者（`packages/workbench/src/distill.ts`）

- `applicability` 字段已含 `generality`；**诚实缺省为未测量**。生产者可在有 transfer 证据时填写。
- 种子（`seeds/`）示范：数学技巧标 `generality: 'universal'`（技术特性声明，种子为 H0 观测性，不冒充 H3）。

### 2.6 transfer 评测（协议已预留，本次启用语义）

- `BenchmarkTask.suiteKind: 'transfer'`（schemas.ts 已存在）——**跨任务族评测**是 `universal` 的证据来源。
- 后续：`aen evaluate` 支持跨任务族矩阵，aggregate 提供 `transfer` 结果，蒸馏时据此填 `generality`。

## 3. 验证

```sh
pnpm schemas:generate   # 21 schemas + 19 fixtures；Optional 字段不扰动 digest
pnpm conformance        # 19 valid / 23 invalid / 19 golden，0 失败
pnpm test               # 全测试
```

种子回归：`node scripts/seed-math-experiences.mjs` → 5 个 experience 带 `applicability.generality: 'universal'`，可检索。

## 4. 兼容性

- **digest 兼容**：Optional 字段 ⇒ 既有对象（无 generality）digest 不变；conformance golden 全过。
- **Schema 向后兼容**：旧对象无 generality ⇒ rank 0（未测量），排名不受惩罚，只是不加权。
- **Hub 兼容**：`ALTER TABLE ... IF NOT EXISTS` 兼容既有 PG 投影；投影可重建。

## 5. 后续（非本 patch）

- `SearchRequest.policy.minGenerality`（本地/DSH 消费端过滤）——当前 hub 已有，消费端可在需要时加。
- transfer 评测接入 SWE-bench/METR 标准任务，产生真实 `universal` 证据（价值证明关键路径）。
