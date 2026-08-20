# ADR-0003: DeepSeek Harness 原生插件是 MVP 的一等交付

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-19
- 影响：MVP M1、`adapter-dsh`、`dsh-plugin`、Local Evidence Store

## 背景

早期内部设计稿已提出 `packages/dsh-plugin` 和 Harness-native plugin surface，但最初整理出的 MVP 仓库结构与 M1 交付只写了 Offline Adapter 与 Live Manifest，未明确要求一个可由 DeepSeek Harness Loader 安装的插件。这样实现很容易退化为外部日志分析器，无法从 Agent scope 的权威 registry 获取 preset、skill、tool 和 policy 的实际组合，也不符合 `Agent = Model + Harness` 的核心目标。

## 决策

MVP 必须提供 DeepSeek Harness 原生 Cordis function plugin：

1. 插件通过 DSH 权威 session/registry capability seam 获取低频配置快照。
2. `request/header` 是 effective Model/tool/system surface 的权威边界；skill/preset/policy 等由对应 live registry 补充。
3. 插件只编排 snapshot 并写入 Local Evidence Store；AEXP schema、digest、Manifest/Artifact 构造归 `protocol` 与 `adapter-dsh`。
4. 插件不建立平行 trace capture，不在每次 tool call 上做同步 I/O、蒸馏、联网或发布。
5. 插件没有 public publish credential；公开仍必须经过独立 review/promotion。
6. 插件注册必须可 dispose，异步失败不得阻断 Agent 主任务。

## 后果

- Offline Adapter 可处理历史 export；原生插件补足 trace 看不到的 Harness registry 与 artifact identity。
- 两种路径输出相同的 AEXP objects，不形成 plugin 私有协议。
- M1 DoD 增加真实 DSH composition load/dispose 测试和 tool-call 热路径零同步 I/O 断言。
