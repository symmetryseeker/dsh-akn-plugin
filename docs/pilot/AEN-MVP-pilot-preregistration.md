# AEN MVP 真实 Pilot 预注册协议

状态：**Draft / 尚未冻结真实 Pilot**

这份文件说明 `aen pilot validate` 接受的本地运行配置。该配置是可执行的 Pilot 前置协议，不是新的 AEXP 交换对象，也不是 Pilot 结果。只有经过 review 的 JSON 被提交并冻结、校验通过、且真实运行完成后，结果才可能成为产品证据。

## 使用方式

```sh
aen pilot validate /absolute/path/pilot-preregistration.json \
  --store /absolute/path/.aen/evidence.sqlite
```

退出码 `0` 表示前置协议闭合，不代表模型效果为正；退出码 `1` 会列出失败关闭原因。校验器会解析冻结矩阵，并从本地 store 精确读取 BenchmarkTask、HarnessManifest 和 ExperienceRevision。

## 顶层字段

```json
{
  "profile": "aen-mvp-pilot-preregistration-v0.1",
  "status": "frozen",
  "frozenAt": "2026-08-20T00:00:00Z",
  "reviewedCommit": "40-or-64-lowercase-hex-commit-id",
  "participants": [],
  "publicHub": {},
  "execution": {},
  "budget": {},
  "privacy": {},
  "matrix": {}
}
```

冻结文件不得含 `TBD`、`TODO`、`PLACEHOLDER` 或 `CHANGEME`。必需约束如下：

- 至少三名 participant，ID 和 `localStoreBoundaryId` 均唯一，并覆盖 publisher、consumer、evaluator；
- Hub 必须是非 localhost 的 HTTPS 地址，且 TLS、监控、备份、密钥轮换、事故响应全部声明开启；
- driver mode 必须是 `live`，停止规则为预先固定 repetitions，并声明 seed policy；
- 有正数 USD 总预算硬上限和预算 owner；
- raw trace 固定 `local_only`，公开内容固定 `reviewed_promotion_only`，人工脱敏复核开启；
- 恰好 2 个已验证且任务族不同的 Benchmark、2 个带 pricing/rate-limit snapshot ref 的 ModelFingerprint、2 个 coverage 完整的 live HarnessManifest；
- 恰好 8 个 Model × Harness × baseline/treatment cells；每个 multi-task treatment 用 `experienceRefsByBenchmark` 精确绑定各任务的 public Experience revision；
- 每个 Benchmark 使用独立的 `comparisonsByBenchmark`，并覆盖四个 Model × Harness 组合；禁止用跨任务 portfolio 或公共 `comparisons[]` 做 H3；
- 只允许排除 `infra_error`、`grader_error`、`aborted`，不得删除 agent failure 或 policy refusal。

矩阵字段和任务级 treatment/analysis 的兼容规则见 [ADR-0019](../adr/0019-task-scoped-evaluation-plans.md)。逐 Benchmark Aggregate 与描述性 portfolio 的边界见 [ADR-0018](../adr/0018-benchmark-sliced-evaluation-aggregates.md)。

## 冻结与修改

先在分支中准备任务、grader、公开 Experience、Manifest、预算和参与者边界。Reviewer 先审查一个不含自引用 hash 的 proposal/review commit；随后 freeze commit 只把 `reviewedCommit` 写成该前序审查提交的 hash。它不能指向包含自身的 commit。第一次 live trial 后不得原地修改。必要变更必须新建 preregistration、记录 amendment reason，并重新开始受影响的 trials，不能根据已见结果调整主指标、排除项或停止规则。

最终命令、digest、参与者边界和结果填写到 [Pilot 报告](./AEN-MVP-pilot-report.md)。
