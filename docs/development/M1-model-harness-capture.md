# M1 Model + Harness Capture 实现记录 — Draft/Pilot

对应 MVP-FR-001～004、MVP-FR-014、MVP-NFR-001，以及 AEXP 0.1 的 Trace/Manifest/Artifact/Evidence Gap 语义。

## 已实现

- `@aen/adapter-dsh` 读取 DSH `session.jsonl` 或根级 ZIP，保留 source namespace/version、mapping version、raw/logical digest 与事件 provenance。
- 只对高价值“失败 → 后续同工具成功”恢复链建立 TaskEpisode；普通 tool call 不生成 Episode。
- 离线对象组合为 TaskEpisode、EvidenceGapReport、TraceEvidenceBundle、RunObservation、trace-only HarnessManifest 与 ArtifactDescriptor。
- DSH skill 的 catalog、model-loaded、user-invoked 三种状态分开；Trace 看见正文也不声称 scripts/references/assets 闭包完整。
- `@aen/dsh-plugin` 是可安装 DSH bundle，并导出四个角色模块：`definition` 定义 opaque `aen` service contract；`policy` 提供本地采集/网络策略；`provider` 注入 `agents`/`skills`/`aenPolicy` 并提供 `aen`；`tools` 注入 `aen`/`aenPolicy`/`tools`。Policy、Provider、Tools 使用独立 Cordis fiber，可分别启停。
- 插件只在首次或发生变化的 effective `request/header` 和 registry/policy 配置边界异步 snapshot；重复的相同 header/request-context 在 Skill registry I/O 前去重，只推进覆盖序号。tool/call、tool/result 不触发 snapshot/I/O/network。
- 核心字段 `HarnessManifest.configurationDigest` 只标识 Harness surface，不混入 Model/Environment；`HarnessManifest.digest` 仍是包含时间和 session scope 的不可变快照摘要。精确 system prompt 保留在运行快照中，稳定配置摘要规范化 cwd 与 Model route。插件按完整 `Model × Harness configuration × Environment` cell 去重，因此切换 Model/Environment 会刷新权威上下文和精确快照，而不会污染 Harness 身份。
- 显式 `captureSkillResources` 授权后，directory Skill 会在固定安全限额内遍历 `SKILL.md` 与完整资源树，生成 content/tree/dependency digest；symlink、特殊文件、共享单文件根、越界或读取失败均降级为 partial。
- Trace 与 Live Manifest 使用本地 session-correlation digest、最近配置边界和 effective-surface digest 严格关联；只有 registry 和每个 Skill closure 都完整时，Workbench 才将配置证据从 H1 提升为 H2。相关性 digest 在 Promotion 时移除。
- Node 22+ 内置 SQLite 本地库保存协议对象、引用关系与 local session metadata；不复制 raw trace bytes，也不要求插件安装时批准 native addon build script。

## DeepSeek Harness 插件证明

`packages/dsh-plugin/test/dsh-real-composition.test.ts` 使用官方发布的 DeepSeek Harness `0.1.0-rc.7`：

- 挂载真实 `SessionStore`、`AgentRegistry`、`SkillRegistry`；
- 注册真实 runtime skill；
- 通过真实 session append `request/context` / `request/header`；
- 加载/卸载 AEN Cordis plugin；
- 验证写入的 HarnessManifest 通过 AEXP Schema/digest 校验；
- 验证显式授权的真实 directory Skill 为 `complete_package`，并具有 `treeDigest` 与逐资源 digest；
- 验证含 symlink 的 Skill 失败关闭为 `partial_snapshot`；
- 验证 dispose 后关闭 listener 与本地 store。
- 挂载官方 `SystemPrompt` 与 `ToolRuntime`，由真实 registry pipeline 执行 `experience_search`；验证模型可见 schema 不含身份摘要、Agent 自动解析的 Model/Harness/Environment 与已保存 Manifest 一致，并验证 agent-less dispatch fail closed 且不发网。
- 重复相同 effective header 不再次读取 Skill registry，随后显式搜索也复用已覆盖的权威 context；registry/policy 边界不受该快路径抑制。

`scripts/dsh-plugin-host-smoke.mjs` 另外验证发布路径，而不是直接导入源码：

- `pnpm pack` 生成含 `dsh.bundle.patch` 和 AEN runtime closure 的 tarball；
- 官方 `dsh plugin --profile web add` 一次安装并把插件加入 bundle 栈；
- 安装后的包在真实 Web profile 中启用 Consumer tools 并启动，不依赖源码绝对路径；
- tarball 同时包含 definition/policy/provider/tools 四个闭合入口，bundle patch 装载三个独立 fiber；
- 默认 Policy 禁止 Hub 和 public publishing；未授权 Policy 下配置 `hubUrl` 会 fail closed；
- HTTP 200 返回官方 `DeepSeek Harness` 页面，本地 evidence store 为 schema v3；
- SIGTERM 优雅退出为 0，官方 `dsh plugin remove` 同时移除依赖与 bundle。

## 明确限制

- 离线 Trace 只能产生 `coverage.mode=trace_only`，不能替代 live Harness registry。
- URL/opaque、共享单文件根及超过安全限额的 Skill 仍只能是 `partial_snapshot`；插件不猜测闭包。
- DSH 没有统一公开 build-version service，插件配置需显式提供 `harnessVersion`。
- policy 只记录可见 durable event 的类别和值摘要，不声称完整策略配置。
- 插件没有 public credential，不执行 Promotion，也不上传 private evidence。
- 普通 `tool/call`/`tool/result` 在 listener 最前置返回，不做 Agent registry lookup、policy scan、snapshot、SQLite 或网络 I/O。可重复 before/after 微基准见 [`DSH-tool-call-hot-path-2026-08-20.md`](../performance/DSH-tool-call-hot-path-2026-08-20.md)；它满足 MVP 同步 I/O=0，但不冒充代表性 whole-workload CPU `<1%` 证据。

证据边界与本地关联规则见 [ADR-0014](../adr/0014-local-trace-live-manifest-reconciliation.md)；安装与本地数据库驱动决策见 [ADR-0017](../adr/0017-installable-dsh-plugin-bundle.md)。
