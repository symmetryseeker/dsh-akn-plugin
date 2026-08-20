# ADR-0004: 区分 Manifest 快照摘要与 Harness 配置身份

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-19

## 问题

`HarnessManifest.digest` 按协议覆盖 `capturedAt`、session scope 和对象身份，因此同一配置在不同捕获时间会得到不同摘要；早期内部设计稿的“配置不变时 digest 稳定”若直接指该字段，与对象摘要规则矛盾，也会破坏插件去重和 Model × Harness 对照。早期 Draft 把稳定身份放在 extension 中，但评测、检索和第三方实现都需要该语义，不能继续把它当作可选扩展。

## 决策

- `HarnessManifest.digest` 继续作为完整不可变快照对象摘要。
- `HarnessManifest.configurationDigest` 是核心必填字段，只覆盖 Harness 版本、preset composition、system/tool/skill surface 与 policy，用作跨次 Harness 配置等价键。Model 与 Environment 都是 Configuration Cell 的独立坐标，不得混入 Harness 摘要。旧 extension 写法不再是 0.1 Draft 的权威表示。
- Model provider/model identity 不进入 Harness 配置摘要；它属于 `ModelFingerprint`。
- DSH 的精确 system prompt 仍进入 `modelSurface.systemPromptDigest`；仅在计算配置身份时，把运行工作区和 Model route 替换为稳定占位符，避免把 cwd 或本来属于 Model 轴的字段混进 Harness 轴。
- Offline `trace_only` 同样排除 Model/request-config 轴并规范化 trace 中可见的 workspace/Model route，但它的摘要只代表不完整的 observed projection，不得与 complete live configuration digest 宣称等价。
- 原生插件按 `Model semantic identity × harness configurationDigest × Environment semantic identity` 去重：同一 cell 不写入仅时间不同的重复快照；Model 或 Environment 改变时写入新的精确 Manifest 并刷新当前 Agent 的消费上下文，但不改变 Harness `configurationDigest`。
- `RunObservation.configurationCell` 同时保存 `ModelFingerprint + harnessConfigurationDigest + harnessManifestDigest + EnvironmentFingerprint`：前者定义冻结配置 cell，后者指向该次运行的可审计 Manifest 快照。
- 评测计划也必须同时冻结稳定配置摘要与一个 reviewed representative Manifest。运行时允许产生新的 Manifest digest，但其 `configurationDigest` 必须与 cell 完全相同。
- Distiller 默认把 `harness.configurationDigest` 写入 Experience applicability；该次 Manifest snapshot 通过 Observation 和 typed `derived_from` relation 保留审计来源。默认使用 `harness.manifestDigest` 作为兼容 selector 会把经验锁死到一次 session，只允许作者在确实需要 snapshot-specific 约束时显式使用。
- Hub 可以同时索引两类 digest，但不得把 stable configuration selector 误当成可解引用对象。Public Promotion 保留配置 commitment，并把 provenance/显式 snapshot selector 重写到 public projected Manifest。
- Public Manifest 的 metadata-only Artifact refs 与私有完整快照不同，因此它必须声明“保留 source configuration commitment，但无法仅凭公开投影重新计算该 digest”；不能用投影后的可见字段假装完成独立复算。
