# ADR-0010：Observation 与 Feedback 必须绑定不可变 Experience digest

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-20
- 影响：RunObservation、FeedbackEvent、evaluation runner、消费闭环、Hub feedback ingress

## 矛盾

Context Plan、section read 与 ContextInjectionObservation 已使用 `{experienceId, revision, digest}` 精确锁定不可变 revision；但 RunObservation 和 FeedbackEvent 又把引用降级为 `{experienceId, revision}`。评测 runner 也只校验 ID/编号。不同内容若错误或恶意复用同一编号，仍可能被计入该 Experience 的 treatment、adoption 或 harmful/helpful 结果。

这破坏了不可变 revision、实际注入证明和可审计反馈三条核心不变式。

## 决策

RunObservation 与 FeedbackEvent 的 `experienceRef` 都必须包含 `digest`。所有 producer、runner 和 Hub ingress 必须按 ID、revision、digest 三元组验证，不允许通过 latest lookup 补猜。baseline Observation 仍可不带 Experience ref；带 ref 时 digest 必需。

## 后果

- AEXP 0.1 仍处 Draft，Schema/fixtures 需要重新生成；旧 Draft payload 必须迁移。
- `applied-experience-digest` extension 不再承担身份语义，可暂留作向后诊断信息。
- Feedback 虽仍是低信任信号，也不能归因到模糊 revision。
- 签名、点赞或相同 revision number 都不能替代 digest equality。
