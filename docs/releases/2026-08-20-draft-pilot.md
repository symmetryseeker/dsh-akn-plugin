# AEN 0.1 Draft / Pilot 发布说明

发布日期：2026-08-20

状态：**Draft / Pilot，不是 Stable，不代表真实模型效果已经得到验证**

## 1. 这次发布是什么

这是 Agent Experience Network（AEN）从“协议与架构设计”进入“可运行参考实现”的第一个完整工程版本。项目的核心对象不是孤立的工具调用，而是带有明确适用边界、证据、成本与结果的 `Model × Harness × Environment` 任务级执行经验。

DeepSeek Harness 是当前首个原生集成目标，但 AEXP 协议本身不绑定单一 Harness。其他 Harness 可以通过 Adapter、MCP 消费接口和相同的协议对象加入网络，而不需要修改协议核心语义。

本次代码用于维护者复核和后续 Pilot 准备。仓库可见性是独立决策，任何公开操作都必须先通过[公开发布边界与历史安全清单](../governance/public-release-boundary.md)。

## 2. 已交付的工程能力

- AEXP `0.1 Draft` Schema、JCS/SHA-256 内容寻址、DSSE/in-toto Attestation 和 conformance fixtures；
- DeepSeek Harness JSONL/ZIP 离线导入、TaskEpisode、TraceEvidence、RunObservation 和 live Harness Manifest；
- 可通过官方插件管理器安装、移除的 DeepSeek Harness Cordis bundle；
- 本地 SQLite 私有证据库、经验蒸馏、人工审查、搜索和按 section 读取；
- Model × Harness × Environment configuration cell、baseline/treatment、`pass@k`、`pass^k` 和证据等级门禁；
- 私有对象到公共对象的显式 Promotion、脱敏、许可、签名、引用闭包和撤回；
- PostgreSQL Reference Hub、兼容性优先搜索、不可变读取、反馈和最小 Web；
- Task Capsule、Context Plan、ContextInjectionObservation 和测量型消费反馈；
- DeepSeek Harness 原生消费接口与通用 MCP Server；
- Sample Harness Adapter、贡献指南、安全策略、Roadmap、ADR、Pilot 预注册和需求证据台账。

## 3. DeepSeek Harness 插件边界

插件默认仅在当前 workspace 写入 `.aen/evidence.sqlite`，不会自动联网、自动发布经验、上传原始 Trace、读取完整 Skill 资源或执行远端 Experience。

Manifest capture、网络消费和本地策略由不同角色管理。即使显式启用 Hub 查询，也必须同时通过本地 Policy；启用搜索不会隐式开启公开发布。

本地打包方式：

```sh
pnpm install --frozen-lockfile
pnpm build
mkdir -p .work/releases
pnpm --dir packages/dsh-plugin pack --pack-destination ../../.work/releases
```

安装到 DeepSeek Harness Web profile：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/aen-dsh-plugin-0.0.1.tgz
pnpm dsh web
```

## 4. 发布验证结果

| 检查 | 结果 |
| --- | --- |
| TypeScript typecheck 与全 workspace build | 通过 |
| 单元、契约和集成测试 | 108 项通过；普通套件中 1 项 PostgreSQL 条件测试跳过 |
| AEXP conformance | 19 valid / 23 invalid / 19 golden，0 failure |
| DeepSeek Harness 插件 Doctor 与 tarball 构建 | 通过 |
| 源码敏感信息扫描 | 未发现 operational secret |
| 生产依赖许可证 | Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC、MIT |
| 生产依赖漏洞审计 | 未发现已知漏洞 |
| 空公共 Registry 投影校验 | 通过 |
| GitHub Actions | 通过 |

确定性的测试私钥只用于生成可复现签名 fixture，不是部署密钥，也未获得 Registry 授权。真实发布者密钥必须由操作者在忽略的本地状态中单独生成。

## 5. 本版本尚未证明的事情

以下内容仍是公开 Roadmap 和 Pilot 门槛，不能因为代码已经合并就视为完成：

1. 真实的 2 Model × 2 Harness configuration × 2 task-family 对照试点；
2. 三名不共享本地证据库的开发者完成跨用户发布、发现、采用、反馈和回滚；
3. 公开可访问的 Pilot Hub 及 TLS、限流、监控、备份、密钥轮换和事件响应；
4. 非核心贡献者独立完成 Adapter 或 Experience contribution；
5. 独立安全审查与真实负迁移案例；
6. 第二套独立兼容实现与协议迁移验证。

因此，本版本可以用于协议讨论、工程集成、私有试验和社区协作，但不能宣称为 Stable、生产安全边界或已经证明能提升所有 Agent 的公共经验网络。

## 6. 社区参与方向

社区可以优先贡献真实 Pilot、Harness Adapter、Benchmark、负面案例、运维加固、安全审查、协议互操作测试和文档可用性反馈。协议字段或语义变更必须先提交 ADR，并保持以下核心不变量：

- Experience 具有明确的 Model、Harness、Environment 和任务适用范围；
- 原始 Trace 默认留在本地，公共对象必须经过人工审查和重新脱敏；
- 签名证明来源与完整性，不证明经验一定正确；
- 兼容性先于相关性，负面证据和适用边界必须保留；
- 公共内容不可自动执行，公开发布和远端消费都必须显式授权；
- Schema、内容摘要、不可变 revision、Promotion 和 Revocation 语义不得被实现绕过。

参与开发前请阅读根目录的 `CONTRIBUTING.md`、`SECURITY.md`、[AEXP 0.1](../../spec/AEXP-0.1.md)、[MVP Implementation Profile](../../spec/AEN-MVP-implementation-profile.md) 和对应 ADR。

## 7. 后续发布条件

完成真实 Pilot、独立贡献者验收和安全审查后，项目可以评估公开仓库和第一个公开 Pilot release。达到 Stable 则还需要多个独立实现、公开迁移规则、生产采用证据以及持续运行的安全与治理流程。
