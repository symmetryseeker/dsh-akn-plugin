# ADR-0005: Claim 与 Contention 只使用可解析引用

- 状态：Accepted
- 日期：2026-08-19

## 问题

AEXP Draft `0.1` 的早期 Claim 只保存 supporting/contradicting observation ID，无法指向 TraceEvidence、Attestation 或 Contention。`EvidenceRef` 又允许 `case`，但 CasePair 是没有独立 digest 的内联结构。同时 `Contention.claimRef: ObjectRef` 把内联 Claim 当成了独立 Protocol Object。这些结构可以通过表面 Schema，却无法被 Registry 解析或完整性校验。

## 决策

- Claim 使用 `supportingEvidenceRefs` 和 `contradictingEvidenceRefs`；前者至少一条，后者可为空但必须披露 evidence gap。
- Claim 通过独立 `artifactRefs` 关联 skill/tool/preset 等 Artifact，不把 Artifact 冒充成 observation。
- `case` 从 EvidenceRef 的 object type 中移除。CasePair 仍为内联展示结构，每个 case 通过 `traceEvidenceRefs` 回指真实 evidence。
- Contention 通过 `{ experienceRef, claimId }` 定位某个不可变 Experience revision 内的 Claim，不伪造 claim digest。
- 这是 Draft `0.1` 内的纠正；conformance digest 随对象内容重算。
