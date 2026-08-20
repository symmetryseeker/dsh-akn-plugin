# M2 Private Experience Loop 实现记录

对应 MVP-FR-004、MVP-FR-005、MVP-FR-008、MVP-FR-014，以及 AEXP 0.1 的 Episode、Experience、Evidence、Applicability 和本地优先语义。

## 对象输入与边界

Distiller 不直接读取 raw Trace，而只接受本地库中已经验证且引用闭合的组合：

```text
TaskEpisode
+ EvidenceGapReport
+ TraceEvidenceBundle
+ RunObservation
+ HarnessManifest
+ referenced ArtifactDescriptor[]
→ private ExperienceRevision
```

当前 deterministic Distiller 只处理带 `high_value_trigger:*` 的 Episode。普通成功 tool call 没有 Episode，也就无法被“反思文本”绕过门禁生成 Experience。

对于 DSH 恢复链，Trace 只证明失败结果先于后续成功结果，通常看不到中间到底修改了什么。因此首版 draft：

- 只产生 H1 observational claim；
- 明说 exact intervention 未捕获；
- `contradictingEvidenceRefs=[]` 时在 Evidence Gap/review 披露；
- recipe 要求本地诊断、显式记录 corrective change、在 policy 内重试、独立验证 acceptance；
- 正反 CasePair 都回指真实 TraceEvidence，不把内联 case 冒充 Protocol Object；
- 不复制 raw prompt、tool arguments/results、hidden reasoning 或 local path。

## Review 与不可变编辑

SQLite schema v3 保存当前 review projection、追加式 `experience_review_events` 和不含正文的 local deletion tombstone。状态为：

- `draft`
- `approved_private`
- `rejected`
- `public_requested`

`public_requested` 只是本地意图，不改变 `governance.visibility`，也不生成 public object。M4 Promotion 必须创建新的脱敏 target revision/digest。

Review packet 同时显示 claim/evidence、ModelFingerprint、HarnessManifest coverage、redaction、EvidenceGap、最高 H-level、artifact license/redistribution 与 known risks。

人工编辑使用 digest-free 下一 revision 模板；导入时强制：

- 同一 `experienceId`；
- revision 恰好加一；
- `supersedes` 精确引用原 revision/digest；
- visibility 仍为 private；
- claim/case/artifact refs 都在顶层引用集合中且能在本地解析；
- 重新进行 pre-digest/published Schema 校验并计算新 digest。

## 本地搜索与获取

- SQLite FTS5 索引 title、summary、task、recipe、cases；
- 同一 Experience 默认只返回最新 revision；
- rejected revision 不进入结果；
- Model/稳定 Harness configuration selector 不匹配时硬过滤，不因文本相似度放行；精确 Manifest snapshot 作为默认 provenance，不把 Experience 锁死到一次 session；
- 搜索先返回受限 ExperienceCard，正文通过 `fetch` 按 recipe/cases/evidence 等 section 获取；
- 搜索与获取没有执行、安装或网络权限。
- `aen delete-local` 只有在 selector 解析出的 digest 与 `--confirm-digest` 完全一致时才删除；它清除正文、FTS、links、session association 和 review rows，启用 SQLite secure-delete、截断 WAL 并 VACUUM，只保留 digest/type/id/revision/reason/time tombstone（ADR-0016）。

## 协议修正

实现 M2 时发现旧 Claim/Contention 引用无法解析，已由 ADR-0005 修正：Claim 使用通用 supporting/contradicting EvidenceRef，artifact 单列；CasePair 继续内联并回指真实 evidence；Contention 使用 ExperienceRevision ref + claimId。
