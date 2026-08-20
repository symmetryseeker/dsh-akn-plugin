# @aen/dsh-plugin — Draft/Pilot

DeepSeek Harness 原生 Cordis bundle。它复用 DSH 的 durable session 与 live registry，在低频配置边界生成 AEXP `HarnessManifest`/`ArtifactDescriptor` 并写入本地 SQLite evidence store。

它不会建立第二套 trace capture，不会在普通 tool call 上做 I/O，也不会上传或公开任何本地证据对象。公开内容仍须经过 AEN review/promotion。可选 Consumer tools 只有在显式启用、且模型实际调用 AEN search/feedback 时才访问 Hub 或写本地反馈。

## 安装为 DSH Bundle

发布物会把 AEN workspace 运行时代码打进各角色入口，并声明标准 `dsh.bundle.patch`；不能只复制一个 JS 文件使用，因为 npm 依赖、bundle patch 和许可文件也是发布物的一部分。

普通用户可直接安装本仓库根 bundle：

```sh
dsh plugin --profile web add github:symmetryseeker/dsh-akn-plugin
dsh web
```

卸载根 bundle 使用 `dsh plugin --profile web remove dsh-akn-plugin`。下面的 `@aen/dsh-plugin` tarball 流程用于本仓库开发和内部发布物验收。

同一发布包包含四个 DSH 角色模块，以及一个供本地评测器调用的库入口：

- `@aen/dsh-plugin/definition`：opaque `aen` Service contract，由 Provider 实例化，不另建空 fiber；
- `@aen/dsh-plugin/policy`：本地采集与 Hub 网络许可，提供 `aenPolicy`；
- `@aen/dsh-plugin/provider`：注入 `agents`、`skills`、`aenPolicy`，捕获 Manifest 并提供 `aen`；
- `@aen/dsh-plugin/tools`：注入 `aen`、`aenPolicy`、`tools`，注册两个可选模型工具。
- `@aen/dsh-plugin/evaluation-driver`：通过官方 headless profile 执行预注册本地矩阵；它不是额外 Cordis fiber，也不会在 Agent 日常运行中自动启动。

Policy、Provider、Tools 是三个独立 Cordis fiber。Tools 默认禁用，卸载或禁用它不会停止 Manifest Provider。

在 AEN 仓库根目录构建 tarball：

```sh
pnpm install
pnpm build
mkdir -p .work/releases
pnpm --dir packages/dsh-plugin pack --pack-destination ../../.work/releases
```

在已构建的 DeepSeek Harness 源码目录安装并启动：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/deepseek-harness-akn/.work/releases/aen-dsh-plugin-0.0.1.tgz
pnpm dsh web
```

若使用已安装的 `dsh`，命令改为 `dsh plugin ...` 和 `dsh web`。安装器会把 `@aen/dsh-plugin` 加进 profile bundle；卸载使用：

```sh
pnpm dsh plugin --profile web remove @aen/dsh-plugin
```

默认配置是 local-only：`storePath=.aen/evidence.sqlite`、`captureSkillResources=false`、`allowHubSearch=false`、`aen-tools.disabled=true`。本地存储使用 Node 22+ 内置 SQLite，不需要原生 addon 的 postinstall/approve-builds。

安装后的配置按角色覆盖。例如显式读取 Skill 资源并启用本地 Consumer tools（仍不联网）：

```yaml
- id: aen-policy
  config:
    captureSkillContent: true
    captureSkillResources: true
    allowHubSearch: false
- id: aen
  config:
    enabled: true
    storePath: /absolute/path/to/project/.aen/evidence.sqlite
    harnessVersion: 0.1.0-rc.7
    snapshotDelayMs: 25
- id: aen-tools
  disabled: false
```

若要查询 Hub，必须同时把 `aen-policy.allowHubSearch` 改为 `true`，并给 `aen-tools.config.hubUrl` 设置地址。只有其中一个条件时不会联网；URL 存在但 Policy 未许可会启动失败并给出明确错误。插件 policy 把 public publishing 固定为 disabled，启用查询不会连带获得发布能力。

## 本地开发加载

本地开发应使用与发布物相同的分角色组合：

```yaml
- name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/policy.js'
  config:
    captureSkillContent: true
    captureSkillResources: true
- name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/provider.js'
  config:
    storePath: /absolute/path/to/project/.aen/evidence.sqlite
    harnessVersion: 0.1.0-rc.7
- name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/tools.js'
```

向 DeepSeek Harness Web UI 的既有 composition 插入本地开发版本时，使用 patch 形式：

```yaml
- insert:
    - id: aen-policy
      name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/policy.js'
      config:
        captureSkillContent: true
        captureSkillResources: true
        allowHubSearch: true
    - id: aen
      name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/provider.js'
      config:
        storePath: /absolute/path/to/project/.aen/evidence.sqlite
        harnessVersion: 0.1.0-rc.7
    - id: aen-tools
      name: '/absolute/path/to/agent-experience-network/packages/dsh-plugin/dist/tools.js'
      config:
        hubUrl: http://127.0.0.1:4173
```

然后在 DeepSeek Harness 源码目录运行：

```sh
pnpm dsh web --patch /absolute/path/to/aen.cordis.yml
```

安装后的 bundle 如需改配置，应在 profile `cordis.patch.yml` 或额外 `--patch` 中以 `- id: aen-policy`、`- id: aen`、`- id: aen-tools` 替换对应配置；不要再次 `insert` 同 id。根入口 `dist/index.js` 只保留给旧的单模块本地开发配置，正式 bundle 不使用它。

捕获边界包括首个实际 `request/header`、后续 effective request header 变化，以及 skill/tool/system-prompt/model route/policy registry 变化。相同 effective header（连同对应 `request/context`）会在读取 Skill registry 前被摘要去重，只更新已覆盖的 request sequence；registry/policy 事件仍强制重新验证。插件随后按 `Model × Harness configuration × Environment` cell 去重写库；完整 `HarnessManifest.digest` 仍标识带 session/time scope 的精确快照。`HarnessManifest.configurationDigest` 只覆盖 Harness surface，不包含独立的 Model/Environment 轴；配置摘要计算会从 prompt 模板身份中规范化 cwd 与 Model route，精确 prompt digest 仍保留在运行快照里。

`hubUrl` 是 Tools 角色的可选项：通过 Policy 许可后，配置时优先查询公共 Hub，连接失败会清楚记录降级并改查本地 SQLite；不配置时全程离线，本地私有对象不会因降级被上传。

启用 `aen-tools` 会注册且只注册两个模型工具：

- `experience_search`：返回最多三张 public 或本地私有 card 和对应 `aexp://` resource URI；Model/Harness/Environment 不由模型填写，而是从当前 DSH `ToolRunContext.agent` 自动解析并绑定，无法建立权威上下文时 fail closed；调用的 AbortSignal 会贯穿 snapshot wait 与 Hub fetch，取消不会误降级到本地；发网前生成最小 Task Capsule 并扫描 secret/path/PII；
- `experience_feedback`：只记录 `viewed/rejected/rolled_back` 等本地低信任反馈，不改变 H-level。

不会注册 `experience_execute` 或 `experience_fetch`。recipe/cases/evidence 正文使用 AEN MCP resource read；可把 `@aen/mcp-server` 作为 DSH MCP server 挂载。`adopted` 必须由记录过 `ContextInjectionObservation` 的客户端路径产生，不能用这个简化 feedback tool 凭空声明。

`captureSkillResources` 是显式本地授权：只对 DSH 声明为 directory resource base、入口为同目录 `SKILL.md` 的 Skill 遍历完整目录，仅读取并保存内容/树/依赖 digest。symlink、特殊文件、范围越界、读取失败或固定限额触发都会失败关闭为 `partial_snapshot`。原始 body/resource 不会被插件上传；按照 MVP public Artifact profile（ADR-0015），无论来源是否允许再分发，公共 Promotion 都会移除 entrypoint、逐资源 commitment、distribution/fetch reference 与 source URI，只保留 digest、许可和受限元数据。

Trace 与 Live Manifest 按本地 session-correlation digest、配置边界和 effective-surface digest 关联，不按 Skill 名称单独猜测。只有 registry 与每个 Skill package closure 都完整时才标记 `skills=complete`；详见 [ADR-0014](../../docs/adr/0014-local-trace-live-manifest-reconciliation.md)。

## Official Headless Evaluation Driver

`aen evaluate` 可直接选择发布包中的 driver：

```sh
aen evaluate <benchmark-id> \
  --matrix /absolute/path/matrix.json \
  --dsh-driver-config /absolute/path/dsh-driver.json \
  --grader /absolute/path/trusted-grader.mjs \
  --store /absolute/path/.aen/evidence.sqlite
```

配置要求官方 `headless` profile 已通过 `dsh plugin --profile headless add <tarball>` 安装并启用本插件。每个 trial 使用独立临时 workspace、精确绑定 Benchmark digest 的 fixture、精确绑定稳定 Harness configuration digest 的 patch、权威 plaintext JSONL 和 session-correlated live Manifest。Treatment 只注入已预算的 card/recipe/cases，并记录 ContextInjectionObservation；不会注入或执行 Artifact、repro 或 evidence body。

grader 是操作者显式选择的本地可信 ESM 模块，不会从 Hub 或 Experience 下载。它必须声明本地已有的 `GraderDefinition` digest，并逐项覆盖 Benchmark acceptance criteria。原始 trace 保存在 `traceRoot`，协议侧只保存 metadata commitment 与本地 locator。

`pnpm test:dsh-evaluation-driver` 会从 tarball 安装插件、启动官方 DSH headless 主机和本地 mock OpenAI-compatible model，再分别通过 driver 库和 `aen evaluate --dsh-driver-config` CLI 完成 trial。验收使用非空 copy fixture，并要求其源树摘要等于 Benchmark Artifact 的 `treeDigest`。它只证明执行、fixture 隔离、Manifest 关联、grading 和证据机制，不证明真实 DeepSeek 模型能力、H3 uplift 或 2×2×2 Pilot。

## Known Limitations and Deferred Work

- policy 目前保存 durable event 的类型与 value digest，不声称 complete policy configuration。
- DSH 未公开统一 Harness build version service，因此应在 composition 中显式设置 `harnessVersion`。

## Compatibility Proof

自动测试使用官方发布的 DSH `0.1.0-rc.7` `SessionStore`、`AgentRegistry` 和 `SkillRegistry` 完成真实服务组合，并验证 load/capture/dispose。组合测试还验证四个角色模块、三个独立 fiber、Provider/Policy 的独立卸载，以及未授权 Hub 配置 fail closed。`pnpm test:dsh-root-plugin-host` 验收公共仓库根 bundle，`pnpm test:dsh-plugin-host` 验收内部 package；两者都从 tarball 走官方 `dsh plugin add`，启动真实 Web profile（含可选 Consumer tools），验证 HTTP 200、本地 schema、SIGTERM 0 和 `dsh plugin remove`。单元测试另外证明 tool-call 热路径不产生 snapshot/write。
