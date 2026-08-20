# ADR-0002：打破 TaskEpisode 与 EvidenceGapReport 的摘要环

- 状态：Accepted
- 日期：2026-08-19
- 影响：AEXP 0.1 Draft、MVP M0/M1

## 背景

早期内部设计稿要求 `TaskEpisode.evidenceGapReportRef` 是含 digest 的 `ObjectRef`，同时又要求 `EvidenceGapReport.episodeDigest` 指回 TaskEpisode。两个不可变对象的摘要因此互相依赖：没有 Gap Report digest 就不能计算 Episode digest，没有 Episode digest 又不能计算 Gap Report digest。合成 fixtures 可以用占位 digest 绕过关系检查，但真实 DSH 导入无法合法构造这组对象。

## 决策

1. `EvidenceGapReport.episodeDigest` 改为稳定的 `episodeId`。
2. 构造顺序固定为：确定 episode ID → 生成并摘要 Gap Report → TaskEpisode 通过 `evidenceGapReportRef` 绑定报告 digest → 摘要 TaskEpisode → TraceEvidenceBundle 绑定最终 `episodeDigest`。
3. Gap Report 与 Episode 的一致性由 `report.episodeId === episode.episodeId` 和 Episode 的精确 ObjectRef 同时验证。

## 与核心项目目标的关系

Evidence Gap 是防止 Trace 被误当完整 Harness 经验的关键机制。修复后仍由 Episode 锁定确切 Gap Report，只移除无法实现的反向摘要依赖；Model + Harness 的证据语义没有被削弱。

## 后果

- M0 Schema 和 conformance fixtures 更新。
- M1 引用完整性测试必须拒绝 episode ID 不一致、gap digest 不一致和缺失 Gap Report。
- AEXP 仍处 Draft 阶段，本修正不引入新的对象或平行格式。
