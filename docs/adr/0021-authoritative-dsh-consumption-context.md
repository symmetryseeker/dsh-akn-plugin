# ADR-0021: DSH 消费上下文必须由宿主权威注入

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-20

## 问题

最初的原生 `experience_search` 把 `model_provider`、`model_id`、`harness_configuration_digest` 和 `harness_manifest_digest` 暴露成模型参数。这些值并不在正常任务语境中，模型通常不知道；即使填写也只是未验证的字符串。结果要么以 `unknown` 兼容性检索，要么允许不可信模型伪造 Configuration Cell，违背“先按 Task × Model × Harness × Environment 排除不兼容经验”的核心目标。

审查同一条路径还发现两个相关身份错误：Harness `configurationDigest` 吸收了 Environment，使两个本应独立的坐标纠缠；Provider 仅按 Harness 摘要去重，使同一 Agent 切换 Model 时仍复用旧的消费上下文。

## 决策

1. Model-facing `experience_search` schema 只接受最小 Task Capsule 字段与三卡上限，不接受任何 Model/Harness/Environment 身份或 digest。
2. DSH Tools 实现使用官方 `ToolRunContext.agent`，通过 Provider 提供的 `aen` service 解析当前 Agent。
3. Provider 等待该 Agent 已排队的 request/config snapshot；必要时，显式 `experience_search` 可以请求一次低频配置边界 snapshot。普通 `tool/call`/`tool/result` 仍在 listener 热路径最前方返回，不触发 capture、SQLite 或网络。
4. 解析结果必须同时包含完整 ModelFingerprint、稳定 Harness `configurationDigest`、精确 `HarnessManifest.digest` 和 EnvironmentFingerprint。没有 Agent、没有权威 request header、capture 失败或 Agent 已 disposed 时，搜索 fail closed。
5. Harness `configurationDigest` 只覆盖 Harness version/preset/system/tool/skill/policy surface。Model 与 Environment 只存在于 Configuration Cell，不进入 Harness 摘要。
6. Provider 按去除时间字段后的 `Model × Harness configuration × Environment` 语义身份去重。同一 cell 复用已保存的 Manifest；Model/Environment 改变时保存新的精确快照并刷新当前 Agent context，即使 Harness 摘要不变。
7. 远端 Hub 不会收到 raw prompt、路径、session id 或本地 Artifact 名称；它只收到最小 Task Capsule 与上述权威 metadata fingerprints。
8. `ToolRunContext.signal` 贯穿 Provider wait 与 Hub fetch。调用取消只停止该调用等待/网络，不取消由 Provider 拥有、可被其他调用复用的 snapshot；Abort 不得进入“Hub 不可用→local fallback”分支。

## 结果

- 模型无需也无法猜测兼容性哈希，Model/Harness 不匹配会在相似度排序前被可靠处理。
- `configurationDigest` 可以跨 OS/runtime 保持同一 Harness 身份；Environment 条件仍可通过独立 selector 精确表达。
- 显式搜索首次可能等待 snapshot delay/Skill registry 读取，因此它不是普通 tool-call 零开销基准的一部分。
- DSH 取消可以及时终止搜索，同时共享的低频 Manifest snapshot 仍可完成并供后续调用使用。
- 如果 DSH 后续提供更直接的 immutable effective-surface service，Provider 可以替换 snapshot resolver；Tools contract 和 AEXP wire objects 不需要改变。

## 验证

- Adapter 回归证明 Model 与 Environment 改变不改变 Harness `configurationDigest`，Harness surface 改变会改变它。
- Coordinator 回归证明同一 Agent 切换 Model 会得到新 Manifest/context，而稳定 Harness 摘要保持一致。
- Consumer 回归证明工具 schema 不含模型可控 digest，Hub request 自动携带四个权威坐标，没有 Agent context 时拒绝搜索。
- 真实 DSH composition 回归加载官方 `SystemPrompt`、`ToolRuntime`、`SessionStore`、`AgentRegistry` 与 `SkillRegistry`，通过 `ToolRuntime.execute()` 而非直接调用 tool body 完成搜索；发出的两个 Harness digest 与 Provider 保存的 Manifest 精确一致，agent-less dispatch 被拒绝且没有网络调用。
- 同一真实 ToolRuntime 回归中，取消信号到达 Hub fetch 后产生失败结果且不调用 local fallback；Coordinator 回归证明取消一个 waiter 不会取消共享 snapshot。
- 独立 Cordis roles 回归通过真实 `aen` service proxy 解析当前 Agent context。
