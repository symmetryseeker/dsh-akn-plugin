# Agent Experience Network：项目总览

Agent Experience Network（AEN）要解决的不是“如何保存更多 Agent 日志”，而是一个更难、也更有价值的问题：

> 当一个 Agent 在某类任务上找到有效方法、踩过关键陷阱或证明某种配置并不适用时，怎样把这段经验变成另一个 Agent 可以发现、判断、验证和反馈的公共资产？

AEN 是一个处于 **Draft / Pilot** 阶段的开放协议与参考实现。它把可复用经验表示为有边界、有证据、可版本化的 `Experience`，并始终把结论限定在具体的：

```text
Task × Model × Harness × Environment
```

其中 Harness 不只是“工具列表”，而是模型真正工作的执行系统，包括 system prompt、preset、Skills、工具及其 schema、上下文装配、权限策略、重试逻辑、记忆和编排方式。

## 1. 为什么需要 AEN

今天，Agent 的执行知识通常散落在四个地方：

- 原始 Trace：细节多，但噪声高、含敏感信息，而且只描述“发生了什么”；
- Prompt、Skill 和配置文件：能描述做法，却很少携带适用范围和验证结果；
- Benchmark 报告：能比较结果，但往往无法直接被运行中的 Agent 消费；
- 人类经验：存在于 issue、聊天、复盘和个人记忆中，很难形成机器可读的共同资产。

直接共享 Trace 不能解决这个问题。绝大多数工具调用只是普通执行步骤；一次成功也不能证明某个 Skill 或配置导致了成功。更严重的是，同一个 Model 在不同 Harness、不同依赖版本或不同权限条件下，表现可能完全不同。

AEN 因此选择一条更克制的路径：

1. Harness 继续负责自己的 Trace；AEN 不重建第二套全量采集系统；
2. 只从高价值任务片段中形成 `TaskEpisode` 候选；
3. 用 Trace 作为证据之一，同时补充 live Harness Manifest、环境摘要和显式评测；
4. 将缺失信息记录为 `EvidenceGap`，而不是推测或补写；
5. 先生成本地私有草稿，经过人工审阅后才允许独立 Promotion；
6. 消费方先看小型 Card，再按预算读取 recipe、cases、evidence 等正文；
7. 新的成功、拒绝、回滚和负迁移作为 Observation/Contention 追加，不覆盖历史。

## 2. 什么是 Experience

一次工具调用回答的是：“发生了哪个事件？”

一个 Experience 回答的是：

- 任务是什么，验收条件是什么；
- 在什么 Model、Harness 和 Environment 下观察或评测；
- 推荐的 recipe、约束或诊断顺序是什么；
- 哪些正例和反例支持这条经验；
- 哪些证据支持或反驳每一项 claim；
- 证据最高只能支持到什么强度；
- 哪些情况不适用，何时应该停止或回滚；
- 成本、延迟、风险和未知项是什么；
- 内容能否再分发，由谁审阅和签名。

一个可分享的 Experience 不是“成功模板”，而是一个可被质疑的、有边界的知识单元。负面结果同样有价值：知道某个做法在什么配置下会失败，可以阻止其他 Agent 重复付出成本。

## 3. 为什么是 Model + Harness，而不是工具调用网络

工具是 Harness 的一个组成部分，但不是经验的正确边界。模型最终看到和能够执行的行为面还取决于：

| 维度 | 典型内容 | 为什么会改变结果 |
| --- | --- | --- |
| Model | provider、model id、请求参数、上下文窗口 | 能力、稳定性、价格、速率和推理方式不同 |
| Harness | prompt/preset、Skill、tool schema、memory、policy、orchestration | 决定模型得到什么上下文、能做什么、何时被拦截 |
| Environment | 仓库状态、依赖、平台、网络、fixture | 同样的动作在不同环境中可能得到不同结果 |
| Task | 目标、风险、约束、验收条件 | 决定“成功”究竟意味着什么 |

因此 AEN 同时保留两个 Harness 身份：

- `HarnessManifest.digest`：某次运行所见精确快照的不可变身份；
- `HarnessManifest.configurationDigest`：去除时间、session 等易变字段后的稳定配置身份，用于匹配和评测 cell。

这既不会抹掉运行来源，也能把真正等价的配置归入同一个比较单元。

## 4. Trace 能看到什么，不能看到什么

Trace 通常能看到请求、模型事件、工具调用、部分 Skill 调用、耗时、结果和 token 使用。但它经常看不到：

- 所有已安装、可用但未被调用的 Skill；
- Skill 的脚本、references、assets、依赖闭包、许可和确切版本；
- 合成后的完整 system prompt 和 context assembly 来源；
- policy、权限、preset、registry shadowing 的完整状态；
- 某个改变为何发生，以及成功是否由这个改变导致；
- 运行外部的仓库、网络和服务状态。

所以 AEN 不会从“Trace 出现了 Skill 名字”跳到“完整 Skill 已知”，也不会从“失败后成功”跳到“已经证明因果”。DeepSeek Harness 插件会在低频配置边界读取 live registry，形成 Manifest；离线导入只能形成 `trace_only` Manifest，并明确列出覆盖缺口。

Skill 可见性被区分为至少四种强度：名称被提及、实际被调用、身份/版本可确定、完整 package closure 可验证。它们不能互相替代。

## 5. 从一次运行到可修复经验

```text
Harness run
   │
   ├─ authoritative Trace / export
   └─ low-frequency live Manifest
            │
            ▼
     selected TaskEpisode
            │
            ▼
 private Experience draft ── EvidenceGap
            │
       human review/edit
            │
      ┌─────┴────────────┐
      ▼                  ▼
 keep private     explicit Promotion
                         │
                         ▼
                  signed public graph
                         │
             search Card → fetch sections
                         │
                         ▼
              adopt / reject / rollback
                         │
                         ▼
       Observation / Feedback / Contention
```

这条链路有三个重要性质：

1. **默认私有**：导入、Manifest 和草稿首先只进入本地 SQLite；
2. **发布不是状态切换**：Promotion 创建经过重新脱敏、重新摘要和签名的公共 revision，不把私有对象原样翻成公开；
3. **知识可以被修复**：后续证据可以缩小适用范围、形成新 revision、提出 contention 或撤回当前发布物，但不会篡改旧 digest。

## 6. 主要协议对象

新开发者不需要一开始掌握全部 Schema。可以先记住下面这组最小关系：

| 对象 | 作用 |
| --- | --- |
| `TaskEpisode` | 从一次或多次运行中选出的高价值任务片段 |
| `TraceEvidence` | 对原始 Trace 的摘要承诺、范围和经脱敏的证据片段 |
| `HarnessManifest` | 运行时 Model/Harness surface 的可验证快照与覆盖说明 |
| `ArtifactDescriptor` | Skill、工具、fixture 等依赖的身份、摘要和许可元数据 |
| `Observation` | 某个配置 cell 下的结果、指标和验收情况 |
| `EvidenceGapReport` | 明确记录缺失字段、原因、后果和补救方法 |
| `ExperienceRevision` | claims、适用性、recipe、正反案例、治理和证据引用 |
| `ExperienceCard` | 搜索阶段返回的小型不可变摘要，不执行任何内容 |
| `PromotionRecord` | 私有源和公共目标之间的本地审计记录 |
| `Feedback` / `Contention` | 记录消费决策、负迁移、冲突证据和修复线索 |

所有可持久化知识对象都使用规范化 JSON 和内容摘要。引用绑定具体 digest，而不只绑定一个可能变化的名字。

## 7. 开发者实际会接触哪些组件

| 组件 | 用途 | 当前默认边界 |
| --- | --- | --- |
| DeepSeek Harness 插件 | 捕获 live Manifest，并可选提供搜索/反馈工具 | 本地写入；工具和联网默认关闭 |
| DSH Adapter | 导入已有 JSONL/ZIP Trace 并形成 Episode/Evidence | 离线、`trace_only`、显式 gap |
| CLI / Workbench | distill、review、search、fetch、evaluate、promote | 人工 review；无自动公开 |
| Local Store | 保存私有证据图和审阅状态 | workspace SQLite |
| Reference Hub | 校验公共 Git contribution 并提供搜索/读取 API | 只接受闭合、签名、授权的公共图 |
| Client / MCP | 让不同 Harness 发现 Card、预算读取 section、记录反馈 | 不提供远端 Experience 执行工具 |
| Evaluation | baseline/treatment、cell-aware trial 和 aggregate | driver/grader 必须由操作者信任并显式指定 |

DeepSeek Harness 是第一个原生集成目标，不是协议的唯一宿主。新的 Harness 通过 Adapter 和 Manifest 约定接入，不需要修改 AEXP 的核心对象模型。

## 8. 一个具体例子

仓库提供了一份脱敏的合成 DSH session：一次 `bash` 调用失败，之后在同一任务片段中出现成功调用；同时 Trace 只展示了部分 Skill 信息。

AEN 导入后不会宣称“重试策略已经被证明有效”，而是形成更谨慎的经验：

- 已观察到同一配置下的失败 → 后续成功顺序；
- 原始参数、结果和本地路径不会复制进 Experience；
- 修正动作没有被 Trace 捕获，所以因果关系为 `not_established`；
- live registry 未被读取，所以 Skill package closure 和 Harness 版本进入 Evidence Gap；
- recipe 要求保留失败信号、明确一个修正、在权限内重试并独立验证验收条件；
- 人工审阅后仍可选择 `keep-private`，整个过程不连接网络。

你可以在 [DeepSeek Harness 本地闭环教程](./tutorials/deepseek-harness-local-loop.md) 中亲自运行这一过程，也可以直接阅读[失败恢复示例](../examples/failure-recovery/README.md)。

## 9. AEN 不是什么

AEN 当前明确不做这些事情：

- 不是把每个 tool call 广播出去的遥测网络；
- 不是上传原始 prompt、hidden reasoning、代码或完整 Trace 的数据管道；
- 不是让 Agent 自动下载并执行陌生 Skill 的包管理器；
- 不是跨 Model/Harness 无条件成立的“最佳实践”排行榜；
- 不是用点赞数替代评测、负面证据和适用边界的信誉系统；
- 不是已经完成真实全球 Pilot 的成熟产品。

协议允许未来形成公共网络、联邦节点、信誉和更完整的供应链能力，但这些能力必须建立在不可变身份、最小披露、可验证证据和显式治理之上。

## 10. 当前成熟度与诚实边界

仓库已经实现端到端的工程闭环：协议 Schema、DSH 导入与原生插件、本地 distill/review/search/fetch、比较评测、显式 Promotion、Reference Hub、消费反馈和 conformance。

但这仍是 `0.1 Draft / Pilot`：

- 真实的跨用户、真实模型、2×2×2 Pilot 尚未完成；
- 当前 fixture、mock model 和 host smoke 证明机制可运行，不证明经验能普遍提升模型质量；
- H1 观察不能冒充 H3 对照评测；
- 插件当前验证目标是 DeepSeek Harness `0.1.0-rc.7`；
- 独立安全审查、非核心贡献者验收和公共运营仍是开放门槛。

## 11. 推荐阅读顺序

如果你第一次进入项目：

1. 阅读[三个端到端故事](./stories.md)，先建立直觉；
2. 运行[DeepSeek Harness 本地闭环教程](./tutorials/deepseek-harness-local-loop.md)；
3. 对照[失败恢复示例](../examples/failure-recovery/README.md)理解产物；
4. 阅读[核心概念](./concepts.md)和[参考架构](./architecture.md)；
5. 实现或评审时再进入 [AEN MVP Implementation Profile](../spec/AEN-MVP-implementation-profile.md) 和 [AEXP 0.1](../spec/AEXP-0.1.md)。

准备贡献新 Harness、Experience 或 Pilot 时，请继续阅读 [Adapter 编写指南](./guides/adapter-authoring.md)、[Experience 编写与审查指南](./guides/experience-authoring-review.md)和 [Pilot 预注册协议](./pilot/AEN-MVP-pilot-preregistration.md)。
