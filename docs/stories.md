# AEN 的三个端到端故事

本文用具体工作流解释 AEN 如何产生、使用和修复经验。第一个故事可以直接用仓库 fixture 复现；后两个是基于已实现协议对象和产品流程写成的现实场景。

它们是**可执行的场景故事，不是已经完成的外部客户案例或真实 Pilot 结果**。仓库不会把合成数据、mock model 或工程 smoke test 写成真实世界成效。

## 故事一：一次失败恢复，为什么还不能写成“最佳实践”

### 现场

开发者林在 DeepSeek Harness 中处理一个软件工程任务。Agent 先加载了两个可用 Skill 的信息，其中实际调用了一个 Skill；随后一次 `bash` 操作失败，Agent 调整后再次调用并成功完成了这一小段任务。

普通日志系统会留下 21 条事件。一个粗糙的经验网络可能立刻抽出一句：“bash 失败时，修改命令并重试。”这句话既缺乏信息，也可能很危险——失败操作可能不可重入，第二次成功也不证明修改就是成功原因。

### AEN 怎样处理

1. DSH 自己保存 durable session Trace。AEN 不在每次工具调用上增加网络请求。
2. Adapter 识别到一个有价值的 `failure_to_recovery` 边界，只把相关序列投影为 `TaskEpisode`。
3. Adapter 对原始 session 计算 digest，并生成只包含序列范围和脱敏摘要的 `TraceEvidence`。
4. 因为这是离线 JSONL，AEN 只能生成 `trace_only` Harness Manifest：它知道请求中的 `deepseek-reasoner`、可见工具 surface 和被调用 Skill，却不知道完整 registry、Skill resources、policy 和 Harness build version。
5. `EvidenceGapReport` 把这些缺口逐项列出。缺口不会被默认值掩盖。
6. Distiller 形成一个私有 `ExperienceRevision` 草稿，其 claim 只说“观察到失败后出现成功”，证据级别为 H1，因果状态为 `not_established`。
7. recipe 不复制私有命令，而是给出四个安全步骤：保存错误类别、明确一个修正、在风险策略内重试、独立验证验收条件。
8. 审阅者看到正例、反例、脱敏报告和 gap 后，选择 `keep-private`。没有任何内容进入公共网络。

### 共享的不是哪一行日志

| 层次 | 被保留的信息 | 被刻意省略的信息 |
| --- | --- | --- |
| Episode | 任务边界、失败/恢复序列、结果、配置引用 | 整个 session 的普通事件 |
| Evidence | session digest、event range、脱敏恢复摘要 | 原始命令、结果、本地绝对路径 |
| Experience | 有限 claim、recipe、正反案例、停止条件 | “这个修改导致成功”的虚假因果结论 |
| Manifest | Trace 可见的 Model/Harness surface | 未加载的 Skill resources、完整 policy/registry |

### 后来的消费者

另一位开发者周遇到相似失败。她的 Agent 搜索 `failure recovery` 时先得到一张小型 `ExperienceCard`。Card 清楚显示：

- compatibility 是 `unknown`，不是 exact；
- 最高证据为 H1；
- 已知失败包括“未经检查重复相同调用”；
- safety labels 要求人工审阅、禁止自动执行。

周只读取 recipe 和 cases。她的 Agent 没有取得原始命令，也不能“执行 Experience”。周采用了诊断顺序，但发现自己的操作有外部副作用，于是在 stop condition 处退出并请求批准。

这仍然是一条成功的消费记录：Experience 帮助她避免了错误重试，而不是替她执行命令。

### 这个故事说明什么

价值来自“选择、边界和反例”，不是来自事件数量。Trace 能证明事件顺序，但不能自动证明完整 Harness 或因果关系。AEN 的正确行为是降低 claim 强度并显示未知项。

你可以在[本地教程](./tutorials/deepseek-harness-local-loop.md)中复现这个故事。

## 故事二：同一个模型，为什么换一个 Harness 配置就不再是同一条经验

### 现场

一家团队用同一个 Model 做依赖升级任务。配置 A 只有 shell 和文件工具；配置 B 额外启用了一个 migration Skill、严格的审批 policy 和不同的 system prompt。两边都报告“任务成功”，但 B 的平均成本更低，也更少出现不必要的文件改动。

如果只按 Model 名称或最终成功率聚合，团队很容易得出错误结论：“这个模型已经学会了迁移任务。”实际上，表现变化可能来自 Skill、policy、prompt 或它们的组合。

### Trace 的盲区

在某次配置 B 的运行里，Trace 只记录 Skill 被调用和最终工具结果。它没有保存：

- Skill 的确切 package digest；
- Skill 引用的脚本和 references；
- registry 中是否还有同名 Skill 被 shadow；
- policy 的完整规则和审批状态；
- 没被调用但仍影响 context assembly 的组件。

因此，“Trace 中有 `migration`”只能证明名字或调用，不能证明完整 Harness 身份。

### AEN 怎样补足

1. DSH 插件在首个有效 request 和 registry/policy 变化等低频边界读取 live services，而不是在每次 tool call 上扫描。
2. 它记录精确 `HarnessManifest.digest`，并计算稳定的 `configurationDigest`。
3. 如果操作者显式允许 `captureSkillResources`，插件只在受限目录内读取 Skill package closure，记录内容、树和依赖 digest；遇到 symlink、越界或限额就 fail closed 为 partial snapshot。
4. Model 轴单独记录 provider、model id 和有效请求参数；环境轴记录 fixture、仓库和平台承诺。
5. 评测器冻结同一 Benchmark，分别在 A/B cell 中运行 baseline/treatment，并保存 cost、latency、success、quality 和 variability。

结果可能是：

- 配置 B 在当前任务族和环境下表现更好；
- 证据支持 `Model M × Harness configuration B × Environment E`，不支持所有 DeepSeek 模型或所有仓库；
- migration Skill 与结果有关联，但如果没有消融或对照，仍不能单独声称它是唯一原因；
- Skill body 可以保持私有，公共 Experience 只发布允许再分发的身份、摘要、许可和受限元数据。

### 消费时发生什么

新 Agent 发起搜索时，AEN Client 从当前 Harness 绑定权威配置上下文。模型不需要猜 `configurationDigest`。搜索先排除明确不兼容的 Experience，再在剩余 Card 中按证据、适用性、成本和风险排序。

如果新 Agent 使用配置 A，配置 B 的经验不会被伪装成 exact match；它最多以 `compatible` 或 `unknown` 出现，并带着差异说明。操作者可以选择先在本地 treatment 评测，而不是直接采纳。

### 这个故事说明什么

Experience 的单位必须是 Model + Harness + Environment 下的任务经验，而不是“某个工具成功了”或“某个模型很好用”。Manifest 解决身份和可见性，评测解决相对效果；两者都不能只靠 Trace 替代。

## 故事三：一条热门经验发生负迁移后，网络怎样自我修复

### 现场

一个公开 Experience 建议在大型 monorepo 中先并行运行一组只读检查，再集中修复。它在 Linux、稳定网络和可并行 CI 的环境里有 H3 对照证据，成本下降明显，因此被多个 Agent 采用。

后来，开发者伊在一个限流严重、测试共享外部状态的环境中使用这条经验。并行检查触发服务限流，其中一个“只读”测试实际改变了共享缓存，任务回滚。

如果网络只记录下载量或点赞，这条经验会继续排在前面。AEN 需要保存的是可解释的负迁移。

### 消费方留下什么

1. Client 在注入 recipe 时记录 `ContextInjectionObservation`，因此可以证明 Agent 实际看到了哪个 Experience revision 和哪些 section。
2. 伊记录 `rolled_back` Feedback，原因是 `negative-transfer`，但 Feedback 本身只是低信任信号。
3. 她运行任务 evaluator，生成一个失败的 `RunObservation`：精确绑定 Experience digest、当前 Model/Harness/Environment cell、验收失败项、成本和延迟。
4. 由于结果直接反驳“这些检查在此类环境中可以安全并行”的 claim，维护者创建 `Contention`，而不是删除原结果。

### 作者怎样修复

作者检查后发现，旧 Experience 的环境前置条件写得太宽。新的 revision：

- 增加“测试必须无共享可变外部状态”的 precondition；
- 把限流服务、串行 fixture 和不可重入检查加入 out-of-scope；
- 增加伊的失败作为 near-neighbor negative case；
- 增加“先执行并发安全探测，否则降级串行”的 fallback；
- 重新评测原 cell 和新发现的风险 cell；
- supersede 旧 revision，但保留旧 digest、原证据和 contention。

Hub 搜索随后会返回新 Card；已经缓存旧版本的 Client 仍能通过 exact digest 检查其状态和撤回信息。旧知识没有被静默改写，新的边界却能传播给后续 Agent。

### 这个故事说明什么

经验网络的信誉不应只属于作者或包，而应落在具体 claim、具体 revision 和具体配置 cell 上。失败、拒绝和回滚不是社区噪声；当它们绑定可验证运行结果时，就是修复公共知识的核心输入。

## 三个故事合在一起

| 阶段 | 故事一 | 故事二 | 故事三 |
| --- | --- | --- | --- |
| 产生 | 从高价值失败恢复片段提炼 | 用 live Manifest 识别真实 Harness 配置 | 消费后出现负迁移 |
| 判断 | H1、因果未建立、保持私有 | 在冻结 cell 中进行对照评测 | Feedback + Observation + Contention |
| 分享 | Card/section，而非原始 Trace | 分享受限 Artifact 身份和适用范围 | 新 revision 缩小边界并保留历史 |
| 安全 | 不执行、不自动公开、原始值留在本地 | Skill closure 需显式授权且可保持私有 | 可回滚、可撤回、不可静默覆写 |

这就是 AEN 的核心循环：把少量宝贵执行经验变成可验证对象，让另一个 Agent 谨慎消费，再用新的运行结果修复它。
