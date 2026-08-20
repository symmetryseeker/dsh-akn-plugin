# M6 Open-source Pilot implementation record — Draft/Pilot

对应 MVP-FR-015、MVP-GOV-001、MVP-GOV-002，以及 AEXP 0.1 的开放验证、版本治理和成熟度门禁。

## 已交付的工程材料

- Apache-2.0 `LICENSE`、CONTRIBUTING、SECURITY、Code of Conduct 和公开 ROADMAP；
- 面向第三方 Harness 的 Adapter authoring guide；
- 不依赖 DSH、也不修改 protocol 的 `@aen/adapter-sample`；
- Experience authoring/review/Promotion/repair guide；
- 把 synthetic engineering dry run 与 live product evidence 分开的 Pilot preregistration/report，以及失败关闭的 `aen pilot validate`；
- 依赖漏洞、依赖许可、源代码 secret、安全边界和剩余风险审计；
- Reference Hub UI、用户入口 README 和开发文档的 Draft/Pilot 成熟度标识。

sample adapter 的普通 `activity` 不生成 Episode；只有显式高价值 `learning/candidate` 才产生 TaskEpisode。由于示例 source 看不到 trace evidence、Model identity、skill closure 与 effective Harness surface，它必须同时生成 H0 EvidenceGapReport，而不能伪装成完整经验。这证明开放接口可组合，也证明 conformance 不是“只要能过 Schema 就提高证据等级”。

## 本次验证

- `pnpm typecheck`：所有实现 workspace 通过；
- `pnpm test`：108 tests passed（普通无数据库环境下 1 条 native PostgreSQL integration 条件跳过）；
- `pnpm test:postgres`：隔离 PostgreSQL 17 Hub suite 14/14 passed；
- `pnpm test:e2e`：独立 CLI/Hub/PostgreSQL/Web 多进程链路、12 个签名对象、public search/exact read/local delete 通过；
- `pnpm test:dsh-plugin-host`：四角色 tarball 经官方 DSH add/Web boot/remove 通过；
- `pnpm test:dsh-evaluation-driver`：同一 tarball 经官方 headless profile 安装，配合本地 mock 模型完成 driver 库与 `aen evaluate` CLI 两条 live trial、Artifact tree-digest-bound copy fixture、Manifest 关联与 metadata-only evidence；不声称真实模型/H3；
- `pnpm test:hub-deployment`：闭合 Hub 目录移出 workspace 后，真实 PostgreSQL/Git/HTTP/Web 链路通过；
- `pnpm conformance`：19 valid、23 invalid、19 golden、0 failures；
- `pnpm build`：所有实现 workspace 构建通过；
- `aen-hub verify`：空贡献基线合法，0 contributions/objects；
- `pnpm audit --prod`：No known vulnerabilities found。

## 尚未关闭的真实 DoD

- 尚无一名项目外、非核心开发者独立完成 Adapter/Experience contribution 的签字验收；
- 尚未运行真实 2 Model × 2 stable Harness configuration × 2 task-family matrix；
- 尚无三名不共享本地数据库的参与者完成 cross-user adoption；
- 尚无经运维审查、TLS/监控/备份/密钥轮换齐备的公网 Reference Hub Pilot；
- 尚未完成外部独立安全审查和 production-scale、多并发 PostgreSQL 容量测试；当前只有声明机器/1,000 Experience/单并发的 MVP latency smoke。

因此能力文档把实现里程碑写为 `M6 engineering dry run`，但项目总体仍是 Draft/Pilot。完成工程与文档不是完成产品试点，空结果表也不能产生 H3 claim。
