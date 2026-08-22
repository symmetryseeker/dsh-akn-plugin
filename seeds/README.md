# AEN 数学种子 / Math Experience Seeds

本目录是 **Agent Experience Network (AEN)** 的**第一批通用型种子经验**，来自 **Math Agent Framework (MAF)** 的真实推导运行。

These are the first **universal-technique seeds** for AEN, grounded in real Math Agent Framework (MAF) derivation runs.

## 内容 / Contents

- `runs/` — MAF bridge 产出的真实推导 run（证据源）：
  - `derive_ces.json` — CES 生产函数推导（边际产出/对数线性化/σ→1 极限）
  - `derive_quadratic.json` — 二次型 U/倒U 推导（FOC/Hessian/Delta SE）
  - `verify_monte_carlo.json` — 蒙特卡洛 FOC 过零验证
- `math-experiences.sqlite` — 由 `scripts/seed-math-experiences.mjs` 生成的 AEN 本地证据库（**重建式，不入库**）

## 5 个通用技巧种子（generality: universal）

| seed | kind | claimType | 技巧 |
|---|---|---|---|
| `ces-marginal-product-order` | execution_strategy | strategy_works | CES 先逐输入求导再化简，σ→1 极限验证 |
| `quadratic-turning-point-soc` | execution_strategy | strategy_works | FOC 拐点 + 二阶导符号分类 U/倒U |
| `ces-degenerate-boundary-parameters` | negative_result | failure_cause | CES 边界参数（σ→1,α→1）奇异，用 Cobb-Douglas 极限 |
| `monte-carlo-foc-bar` | safety_constraint | safety_constraint | MC 验证需固定 seed+容差，通过率≥95% |
| `symbolic-foc-empty-set-recovery` | failure_recovery | strategy_works | FOC 空解集 → 配方法恢复拐点 |

所有种子为 **H0（单 run 观测性）**，诚实标注不构成因果；`generality: universal` 经协议扩展 `extensions['https://aen.dev/extensions/aen/generality']` 标记（阶段 5 将提升为一等公民字段）。

## 重新生成 / Regenerate

```sh
node scripts/seed-math-experiences.mjs
# → seeds/math-experiences.sqlite（5 个 experience_revision + 证据对象）
# → 打印 digest 与检索验证
```

## 使用 / Use

种子在本地库中为 `draft`（private）。可经 AEN 工作流审阅（`aen review`）后晋升为公共贡献：

```sh
aen review <experience-id> --decision request-public   # 标记申请公开
aen promote <experience-id> --public --out contributions/<candidate>
```

## 为何这些是"通用"种子 / Why these are universal

数学技巧（求 FOC、配方法、极限验证、数值容差）**跨任何经济/优化/工程场景可迁移**——它们是 Agent 经验网络的"预训练/社会化知识"层，共进化指导自进化的第一块基石。
