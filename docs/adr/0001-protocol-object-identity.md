# ADR-0001：统一可引用协议对象的身份与摘要生命周期

- 状态：Accepted
- 日期：2026-08-19
- 影响：AEXP 0.1 Draft、MVP M0

## 背景

早期内部设计稿同时存在两条互相冲突的定义：通用规则要求所有协议对象携带 `protocolVersion`，但 `EvaluationTrial`、`EvaluationAggregate` 和 `ContextInjectionObservation` 等可被引用对象缺少协议头或 `digest`。此外，`ExperienceContextPlan.taskCapsuleDigest` 要求 Capsule 有稳定摘要，而原接口没有 `digest`。这会使 Schema、`ObjectRef`、签名 subject 和 Hub ingest 对同一数据产生不同解释。

对象摘要的构造顺序也存在循环：published Schema 要求 `digest`，旧顺序却要求对象先通过该 Schema 才能计算 `digest`；带 Attestation 的对象还可能把签名重新纳入摘要。

## 决策

1. 凡是可持久化、可通过 `ObjectRef` 引用、可签名、进入 conformance fixture 或跨进程交换的 AEXP Protocol Object，都必须具有：
   - `protocolVersion: "0.1"`；
   - 稳定的 `objectType`；
   - 类型专属 ID；
   - `digest`；
   - 可选的 `requiredCapabilities` 与 namespaced `extensions`。
2. `EvaluationTrial`、`EvaluationAggregate`、`GraderDefinition`、`TaskCapsule`、`ExperienceContextPlan` 和 `ContextInjectionObservation` 按上述规则补齐。
3. `SearchRequest` 与 `ExperienceCard` 是受 Schema 约束的 API payload/projection，不获得 Registry 对象身份。
4. 摘要生命周期固定为：严格 pre-digest content 校验 → 仅排除顶层摘要/签名字段 → RFC 8785 JCS → SHA-256 → published Schema 校验 → 可选签名 → 再次完整校验。
5. 目标对象的摘要不包含顶层 Attestation，避免循环依赖；嵌套业务字段中的同名键仍参与摘要。

## 与核心项目目标的关系

该决策不改变产品范围，而是确保 Model + Harness 经验在本地、Git 和公共 Hub 之间保持同一身份。没有稳定可验证的对象边界，跨开发者经验复用、反对证据、撤回和独立复验都无法可靠成立。

## 后果

- M0 Schema 与 TypeScript types 以此分类为唯一实现方式。
- 未知 required capability 必须 fail closed；未知 optional extension 原样保留。
- 这是 Draft 阶段的矛盾修复，不引入 MVP-only wire object，也不改变 AEXP 协议版本。
