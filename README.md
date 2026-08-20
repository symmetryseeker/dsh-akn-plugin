# Agent Experience Network

[![npm version](https://img.shields.io/npm/v/dsh-akn-plugin)](https://www.npmjs.com/package/dsh-akn-plugin)
[![license](https://img.shields.io/github/license/symmetryseeker/dsh-akn-plugin)](https://github.com/symmetryseeker/dsh-akn-plugin/blob/main/LICENSE)
[![awesome-dsh-plugin](https://awesome.re/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![AEXP 0.1 Draft/Pilot](https://img.shields.io/badge/AEXP%200.1-Draft/Pilot-9cf)](https://github.com/symmetryseeker/dsh-akn-plugin/tree/main/spec)

> This repository is the public `dsh-akn-plugin` distribution and the AEN/AEXP reference implementation. It is maintained jointly by [symmetryseeker](https://github.com/symmetryseeker) and Jiaoyang Li ([@jiaoyangli-shadow7day](https://github.com/jiaoyangli-shadow7day)). See [Maintainers](./MAINTAINERS.md) and the [migration record](./MIGRATION.md).

Agent Experience Network（AEN）是一个处于 Draft/Pilot 阶段的开放协议与实现，目标是让不同开发者的 Agent 在明确的 `Model × Harness × Environment` 适用范围内，共享经过审查和验证的任务级执行经验。

项目不会把每次工具调用发布成知识，也不会默认上传原始 Trace。Trace 是证据来源之一；可分享的 Experience 必须同时描述任务、Model、Harness Manifest、结果、正反例、适用边界和证据强度。

## 30 秒理解这个项目

当一个 Agent 完成任务、从失败中恢复或发现某种配置不适用时，真正值得共享的不是全部日志，而是少量经过选择和审阅的任务经验：它在什么任务、Model、Harness 和环境下成立，证据有多强，怎样复用，何时不要用。

AEN 提供从本地证据到可修复公共知识的完整链路：

```text
Trace + live Harness Manifest
        → selected TaskEpisode
        → private Experience draft
        → human review / evaluation
        → explicit Promotion
        → Card discovery + budgeted section read
        → Observation / Feedback / Contention
```

默认行为是本地和私有。DeepSeek Harness 插件复用 DSH 自己的 durable Trace，只在低频配置边界补充 Trace 看不到的 live Manifest；它不会在每次工具调用时上传数据，也不会自动发布或执行远端 Experience。

## 第一次来，从这里开始

| 你想知道什么 | 推荐入口 |
| --- | --- |
| 项目为什么存在、完整机制和边界 | [项目总览](./docs/overview.md) |
| 一段经验如何产生、消费和被负面证据修复 | [三个端到端故事](./docs/stories.md) |
| 亲手跑通 DSH 导入、提炼、审阅、搜索和读取 | [DeepSeek Harness 本地闭环教程](./docs/tutorials/deepseek-harness-local-loop.md) |
| 对照 fixture、对象图和 Experience Card 理解产物 | [失败恢复示例](./examples/failure-recovery/README.md) |
| 直接进入规范与实现约束 | [AEN MVP Implementation Profile](./spec/AEN-MVP-implementation-profile.md) 与 [AEXP 0.1](./spec/AEXP-0.1.md) |

最快的体验不需要安装 Hub 或配置模型 API：教程使用一份脱敏的合成 DSH session 和临时 SQLite，在本地展示 21 个 Trace 事件如何只形成 1 个 H1 候选 Experience，以及普通成功 fixture 为什么产生 0 个 Episode。

公开规范与项目入口：

- [AEXP 0.1 协议规范](./spec/AEXP-0.1.md)
- [AEN MVP Implementation Profile 0.1](./spec/AEN-MVP-implementation-profile.md)
- [核心概念](./docs/concepts.md)与[参考架构](./docs/architecture.md)
- [示例索引](./examples/README.md)
- [先行研究与标准映射](./docs/research/prior-art-and-standards.md)（非规范性）
- [M0 Capability Matrix](./docs/capabilities/aen-mvp-0.1.json)
- [MVP 逐条需求证据台账](./docs/development/MVP-requirement-evidence-ledger-2026-08-20.md)
- [AEN 0.1 Draft / Pilot 发布说明](./docs/releases/2026-08-20-draft-pilot.md)
- [公开发布边界与历史安全清单](./docs/governance/public-release-boundary.md)
- [核心维护者](./MAINTAINERS.md)与[旧插件迁移说明](./MIGRATION.md)

当前已实现 M0、M1、M2 私有闭环、M3 本地评测核心、M4 Public Promotion/Reference Hub 核心、M5 消费/修复闭环，以及 M6 的开源工程材料：

- AEXP `0.1 Draft` Schema、JCS/SHA-256、DSSE/in-toto 与 conformance；
- DSH JSONL/ZIP 离线导入、TaskEpisode、TraceEvidence、RunObservation；
- 可由官方插件管理器安装的 DeepSeek Harness 原生 Cordis bundle；definition、policy、provider、tools 四个角色分离，在低频配置边界捕获 live Harness Manifest；
- SQLite 本地证据库；
- constrained Distiller、人工 review/edit、私有搜索和按 section 获取。
- cell-aware Benchmark/Trial/Aggregate、baseline/treatment、`pass@k`/`pass^k`、H-level 门禁与 2×2×2 覆盖检查；内置官方 DSH headless driver 已用安装后插件和 mock 模型完成机制验收。
- private → public 不可变 Promotion、脱敏/许可/签名、闭合公共证据图与 Git contribution；
- 授权密钥 ingress、PostgreSQL 可重建投影、兼容性搜索/读取/feedback/export API、最小 Web 与 emergency tombstone。
- 最小 Task Capsule、immutable Card、Context Plan/预算门禁、ContextInjectionObservation、测量型 feedback/RunObservation；
- DSH native 与 MCP 的两个工具预算（search/feedback）和按 URI section resource read，无 execute tool。
- 社区 sample Harness Adapter、作者/审查指南、开源治理、安全审计与真实 Pilot 预注册报告。

## 作为 DeepSeek Harness 插件使用

最直接的方式是让 DeepSeek Harness 从本仓库安装根 bundle：

```sh
dsh plugin --profile web add github:symmetryseeker/dsh-akn-plugin
dsh web
```

卸载使用 `dsh plugin --profile web remove dsh-akn-plugin`。安装器读取根目录的 `dsh.bundle.patch`，加载 AEN Policy、Provider 和默认禁用的 Consumer Tools。

参与本仓库开发时，也可以先从源码构建内部的 `@aen/dsh-plugin` tarball：

```sh
pnpm install
pnpm build
mkdir -p .work/releases
pnpm --dir packages/dsh-plugin pack --pack-destination ../../.work/releases
```

然后在已构建的 DeepSeek Harness 源码目录安装并启动；若使用已安装的 `dsh`，去掉前面的 `pnpm` 即可：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/deepseek-harness-akn/.work/releases/aen-dsh-plugin-0.0.1.tgz
pnpm dsh web
```

安装命令会把 `@aen/dsh-plugin` 自动加入 Web profile 的 bundle 栈；`dsh plugin --profile web remove @aen/dsh-plugin` 会同时移除依赖和 bundle。默认只写当前 workspace 下的 `.aen/evidence.sqlite`，不联网、不公开对象、不读取完整 Skill 资源，也不注册模型工具。

如需覆盖默认配置，在 profile 的 `cordis.patch.yml` 或 `--patch` 文件中按 id 替换完整配置：

```yaml
- id: aen-policy
  config:
    captureSkillContent: true
    captureSkillResources: true
    allowHubSearch: true
- id: aen
  config:
    enabled: true
    storePath: /absolute/path/to/project/.aen/evidence.sqlite
    harnessVersion: 0.1.0-rc.7
- id: aen-tools
  disabled: false
  config:
    hubUrl: http://127.0.0.1:4173
```

`aen-tools` 默认禁用；即使启用，联网也同时要求 `aen-policy.allowHubSearch=true` 和非空 `hubUrl`。插件没有公开发布凭据，以上配置仍不能自动发布 Experience。

本地插件开发时仍可用绝对路径插入，不需要先安装 tarball：

```sh
pnpm dsh web --patch /absolute/path/to/development-aen.cordis.yml
```

`pnpm test:dsh-root-plugin-host` 会验收仓库根目录的 `dsh-akn-plugin` 发布物；`pnpm test:dsh-plugin-host` 会验收内部 `@aen/dsh-plugin` 发布物。两者都执行真实的 pack → `dsh plugin add` → 官方 Web 启动/HTTP 200 → SQLite schema → SIGTERM 0 → `dsh plugin remove`，并要求嵌套的 `deepseek-harness/` 已先按官方要求完成 `pnpm run build`。

插件直接复用 DSH 的 durable session、agents、skills 与 effective `request/header`，不会另建全量 Trace，也不会在每次 tool call 上做同步 I/O 或网络上传。详细边界见 [DSH 插件说明](./packages/dsh-plugin/README.md)、[M1 实现记录](./docs/development/M1-model-harness-capture.md) 与 [ADR-0017](./docs/adr/0017-installable-dsh-plugin-bundle.md)。

## 本地私有经验闭环

```sh
aen import dsh <session-export>
aen episode list
aen distill <episode-id>
aen review <experience-id>
aen review <experience-id> --decision keep-private
aen search "failure recovery" --local
aen fetch <experience-id> --include recipe,cases,evidence
aen evaluate <benchmark-id> --matrix <matrix.json> --driver <trusted-driver.mjs>
aen evaluate <benchmark-id> --matrix <matrix.json> --dsh-driver-config <dsh-driver.json> --grader <trusted-grader.mjs>
aen pilot validate <pilot-preregistration.json> --store <evidence.sqlite>
aen feedback <experience-id> --decision rejected --outcome harmful --reason negative-transfer
aen delete-local <object-id> --confirm-digest sha256:<exact> --reason author_request
```

`review` 不带 decision 时只展示 claim/evidence、Model × Harness 配置、redaction、Evidence Gap、许可与风险。使用 `--export-edit <file>` 导出下一 revision 模板，编辑后用 `--replace <file>` 导入；原 revision 不会被覆盖。

## 显式公开与 Reference Hub

```sh
aen init --actor https://github.com/jiaoyangli-shadow7day --display-name jiaoyangli
aen review <experience-id> --decision request-public
aen promote <experience-id> --public --out contributions/<candidate> --consent <git-audit-ref>

aen-hub verify --git-root contributions --keys contributions/authorized-keys.json
aen-hub rebuild --git-root contributions --keys contributions/authorized-keys.json
aen-hub serve --git-root contributions --keys contributions/authorized-keys.json
```

Hub 使用 `DATABASE_URL` 指向 PostgreSQL。PromotionRecord 含私有 source ref，因此按 AEXP 0.1 默认只保存在本地审计域；公共贡献只包含重新脱敏、签名且引用闭合的 target graph。详见 [M4 实现记录](./docs/development/M4-public-promotion-and-hub.md) 与 [ADR-0007](./docs/adr/0007-private-promotion-link-boundary.md)。

Reference Hub 可生成不依赖 monorepo 的 portable deployment，容器入口和 PostgreSQL Compose 配置见 [Hub 部署说明](./apps/hub/README.md)。`pnpm test:hub-deployment` 会把部署目录移出 workspace，再运行真实 PostgreSQL、Git ingest、HTTP search、exact-digest read 与 Web 验收。它证明发布物闭合，不代表已经存在公网 Pilot 服务。

正式撤回会清除 Hub 活跃正文并保留最小 tombstone；同一个 reviewed Git change 还必须从 Registry 当前树移除 `affectedDigests` 所在旧 contribution。`aen revoke` 会输出这一 required action，并可用 `--affected-digest` 声明 secret/evidence closure。Git 历史和别人已经取得的 clone 无法被召回，边界见 [ADR-0016](./docs/adr/0016-deletion-revocation-and-git-boundary.md)。

通用 Harness 可启动 [AEN MCP Server](./apps/mcp/README.md)，只暴露 `experience_search` / `experience_feedback` 和 `aexp://` resources。DeepSeek Harness 用户可显式启用 `aen-tools`，并由独立的 `aen-policy` 决定是否允许 Hub 查询；原生搜索会从当前 DSH Agent 自动绑定 Model × Harness × Environment 上下文，不要求模型猜测任何 digest，关联失败时拒绝搜索。消费预算与 adopted 证据边界见 [M5 实现记录](./docs/development/M5-consumption-and-repair-loop.md) 与 [ADR-0021](./docs/adr/0021-authoritative-dsh-consumption-context.md)。

## 社区扩展与 Pilot

- [Harness Adapter 编写指南](./docs/guides/adapter-authoring.md) 与 [`@aen/adapter-sample`](./packages/adapter-sample/README.md) 证明新 Harness 无需修改 AEXP Schema；
- [Experience 编写与审查指南](./docs/guides/experience-authoring-review.md) 覆盖 private draft、证据/H-level、Promotion 和反馈修复；
- [真实 Pilot 预注册协议](./docs/pilot/AEN-MVP-pilot-preregistration.md) 与 [可重现 Pilot 报告](./docs/pilot/AEN-MVP-pilot-report.md) 将工程 dry run 与尚未执行的真实 2×2×2/cross-user 试点明确分开；
- [M6 pre-public audit](./docs/security/M6-pre-public-audit.md)、[Security Policy](./SECURITY.md) 与 [Roadmap](./ROADMAP.md) 公开剩余门槛。

评测 driver/grader 必须是内置发布入口或用户显式指定的本地可信 ESM 模块；它们不是从 Experience 下载的代码。内置 DSH driver 只使用官方 `headless` profile，并要求 AEN 插件已安装；非空 copy fixture 必须由 Benchmark Artifact 的 `treeDigest` 精确绑定。`synthetic_test` 与 mock-model host smoke 都不能满足真实试点或 H3。多任务计划必须分别绑定各 Benchmark 的 Experience revision 和 comparison；`aen pilot validate` 只证明冻结设计闭合，不会把空表变成产品证据。

本仓库尚未达到 Stable 标准。插件和 CLI 仍不会自动公开对象、上传原始会话或执行远端 Experience；公开只能经过人工 review、独立 Promotion 和显式 Git PR。真实的 2×2×2 DSH 试点仍需要可用模型路由、预算、两个经验证任务族和独立参与者；当前测试证明的是评测器、Hub 与消费策略语义，不冒充真实模型结果。M6 的文档、sample adapter 和工程审计已具备，但真实 Pilot、非核心贡献者验收与独立安全审查仍是开放门槛。
