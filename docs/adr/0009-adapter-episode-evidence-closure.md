# ADR-0009：HarnessAdapter 必须返回闭合的 Episode evidence pair

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-20
- 影响：AEXP Adapter SDK、MVP-FR-002、MVP-FR-015、社区 Adapter conformance

## 矛盾

`TaskEpisode` Schema 强制要求 `evidenceGapReportRef`，但早期设计接口的 `HarnessAdapter.deriveEpisodes()` 返回 `AsyncIterable<TaskEpisode>`。标准调用者只能获得 Episode，无法获得被它引用的 `EvidenceGapReport`，因而不能把 Adapter 输出原子地写入 Local Evidence Store，也无法建立闭合 contribution/evidence graph。

DSH Adapter 通过非标准 `importEvidence()` 返回完整 chain，sample Adapter 通过 `getGapReports()` 绕过，这证明旧接口实际不可组合。继续保留会让“社区 Adapter 只实现统一接口即可加入”成为假命题。

## 决策

`deriveEpisodes()` 改为返回 `AsyncIterable<EpisodeEvidence>`：

```ts
interface EpisodeEvidence {
  episode: TaskEpisode
  gapReport: EvidenceGapReport
}

interface HarnessAdapter {
  identify(): Promise<HarnessIdentity>
  importTrace(input: TraceInput): AsyncIterable<NormalizedEvent>
  deriveEpisodes(events: AsyncIterable<NormalizedEvent>): AsyncIterable<EpisodeEvidence>
  snapshotManifest?(context: ManifestContext): Promise<HarnessManifest>
  resolveArtifacts?(refs: ArtifactRef[]): Promise<ArtifactDescriptor[]>
}
```

Episode 的 `evidenceGapReportRef` 必须精确解析到同一个 pair 中 Gap Report 的 identity/digest。TraceEvidenceBundle、RunObservation 等更丰富对象仍可由 Adapter 的 profile-specific high-level import result 返回；本 ADR 只修复所有 Adapter 都必须满足的最小引用闭包。

## 后果

- AEXP wire objects 和 Schema 不变；这是 Draft Adapter SDK 的类型修正。
- DSH、sample 与第三方 Adapter 必须迁移返回值并通过 pair closure 测试。
- Local importer 不再依赖 Adapter 私有 getter 获取 Gap Report。
- 旧的只返回 TaskEpisode 实现编译失败，避免静默产生悬空引用。
