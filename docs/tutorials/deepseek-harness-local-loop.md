# 教程：用 DeepSeek Harness Trace 跑通本地经验闭环

本教程从一份脱敏的合成 DeepSeek Harness session 开始，在本地完成：

```text
DSH JSONL → TaskEpisode → private Experience → human review → local search → section fetch
```

全过程使用临时 SQLite 数据库，不需要 Hub、账号、API key 或公网服务，不会上传 Trace，也不会发布 Experience。预计用时 10–15 分钟。

> 这份 fixture 用于验证机制，不是外部用户案例，也不能证明某种策略对真实模型有提升。

## 1. 前置条件

- Node.js 22 或更高版本；
- pnpm 11.19；
- macOS、Linux，或能够运行 Node 内置 SQLite 的环境；
- 已 clone 本仓库并进入仓库根目录。

检查版本：

```sh
node --version
pnpm --version
```

安装依赖并构建：

```sh
pnpm install --frozen-lockfile
pnpm build
```

后续命令直接调用构建后的 CLI：

```sh
node apps/cli/dist/main.js --help
```

Node 22 可能打印 `SQLite is an experimental feature` 警告；这不表示 AEN 命令失败。

## 2. 创建隔离的本地证据库

在当前 shell 中运行：

```sh
aen_tutorial_dir=$(mktemp -d "${TMPDIR:-/tmp}/aen-tutorial.XXXXXX")
aen_tutorial_store="$aen_tutorial_dir/evidence.sqlite"
```

本教程不会修改默认的 `.aen/evidence.sqlite`。如果关闭 shell 后想找到临时库，可以先打印路径：

```sh
printf '%s\n' "$aen_tutorial_store"
```

## 3. 看一眼输入，但不要把它当作 Experience

输入文件是：

```text
fixtures/dsh/failure-recovery-skills.session.jsonl
```

它包含 21 个合成 DSH 事件，核心片段是：

- request header 使用 `deepseek/deepseek-reasoner`，reasoning effort 为 high；
- session 中可以看到 Skill catalog 和 Skill 调用，但看不到完整 Skill package closure；
- 前一个 `bash` result 失败；
- 后一个 `bash` result 成功；
- session 最终完成。

文件里的 command、result 和路径都是脱敏占位内容。AEN 的目标不是复制这些事件，而是判断其中是否存在值得审阅的任务级经验。

## 4. 导入 DeepSeek Harness session

```sh
node apps/cli/dist/main.js import dsh \
  fixtures/dsh/failure-recovery-skills.session.jsonl \
  --store "$aen_tutorial_store"
```

关键输出应类似：

```json
{
  "imported": true,
  "normalizedEventCount": 21,
  "episodeCount": 1,
  "objectCount": 9,
  "manifest": {
    "mode": "trace_only",
    "limitations": [
      "Offline DSH import observes an append-only session log, not a live Harness registry snapshot."
    ]
  }
}
```

这里已经能看到两个重要边界：

1. 21 个事件只产生 1 个高价值 Episode，而不是 21 条网络经验；
2. 离线 Trace 不能声称看到完整 Harness，所以 Manifest 是 `trace_only` 并携带 limitations。

输入内容固定时，协议对象的 ID 和 digest 是确定的；`store` 路径和 `storedAt` 会随本次运行变化。

## 5. 检查候选 TaskEpisode

```sh
node apps/cli/dist/main.js episode list \
  --store "$aen_tutorial_store"
```

fixture 当前会产生：

```json
{
  "episodeId": "urn:aen:episode:dsh:946181182c9e9fdb0d99a4fd",
  "outcome": "success",
  "fromSeq": 10,
  "toSeq": 17
}
```

Episode 只覆盖失败到后续成功的相关边界。普通启动、catalog 和无关事件没有被包装成 Experience。

如果你想检查完整对象和引用闭包：

```sh
node apps/cli/dist/main.js inspect \
  urn:aen:episode:dsh:946181182c9e9fdb0d99a4fd \
  --store "$aen_tutorial_store"
```

## 6. 提炼私有 Experience 草稿

```sh
node apps/cli/dist/main.js distill \
  urn:aen:episode:dsh:946181182c9e9fdb0d99a4fd \
  --store "$aen_tutorial_store"
```

关键输出：

```json
{
  "experience": {
    "experienceId": "urn:aen:experience:dsh:recovery:5b451faa68147f94cd05223b",
    "revision": 1,
    "visibility": "private",
    "maxEvidenceLevel": "H1"
  },
  "review": {
    "state": "draft",
    "note": "Deterministic private draft; no public Promotion has been performed."
  }
}
```

为什么最高只是 H1？因为 fixture 只证明观察顺序：一次调用失败，后续调用成功。Trace 没有捕获中间的完整纠正过程，也没有 baseline/treatment 对照，因而不能支持因果 claim。

## 7. 像审稿一样审阅，而不是像发布按钮一样确认

先只查看 review packet，不做决定：

```sh
node apps/cli/dist/main.js review \
  urn:aen:experience:dsh:recovery:5b451faa68147f94cd05223b \
  --store "$aen_tutorial_store"
```

请重点检查：

- `claims[].mode` 是否为 `observational`；
- `claims[].falsificationConditions` 是否可执行；
- `configuration.model` 和 `configuration.manifest.coverage`；
- `evidenceGap.missing` 是否列出 live registry、风险分类、反事实、Harness 版本和 Skill closure；
- `redaction.hiddenOrRemoved` 是否移除了参数、结果和本地路径；
- `knownRisks`、正例和反例是否都存在。

本教程明确选择保持私有：

```sh
node apps/cli/dist/main.js review \
  urn:aen:experience:dsh:recovery:5b451faa68147f94cd05223b \
  --decision keep-private \
  --reviewer urn:aen:actor:tutorial-reviewer \
  --note "Verified as a local tutorial example; do not publish." \
  --store "$aen_tutorial_store"
```

状态会变为 `approved_private`。这一步不会生成公共对象，也不会连接网络。

如果是自己的真实草稿，可以用 `--export-edit <path>` 导出 digest-free 的下一 revision 模板，人工编辑后再用 `--replace <path>` 导入。旧 revision 不会被覆盖。

## 8. 模拟另一个 Agent 的本地发现过程

搜索先返回小型 Card，而不是整个 Experience：

```sh
node apps/cli/dist/main.js search "failure recovery" \
  --local \
  --store "$aen_tutorial_store"
```

你应该看到：

```json
{
  "title": "Recover after a failed bash call and verify the retry",
  "compatibility": "unknown",
  "maxEvidenceLevel": "H1",
  "safetyLabels": [
    "human-review-required",
    "no-automatic-execution",
    "observational-only"
  ],
  "availableSections": [
    "claims",
    "applicability",
    "task",
    "governance",
    "recipe",
    "cases",
    "evidence",
    "artifacts"
  ]
}
```

`compatibility=unknown` 是正确结果：查询没有提供当前 Model/Harness 配置，系统不会把未知伪装成匹配。真实 DSH Consumer tool 会从当前 Agent 绑定权威上下文；绑定失败时拒绝带上下文搜索。

Card 还会给出每个 section 的估算 token，供客户端在读取正文前制定 Context Plan。

## 9. 只取需要的 section

```sh
node apps/cli/dist/main.js fetch \
  urn:aen:experience:dsh:recovery:5b451faa68147f94cd05223b \
  --include recipe,cases,evidence \
  --store "$aen_tutorial_store"
```

观察三个细节：

1. recipe 要求先保存失败信号、再记录一个纠正、检查风险后重试、最后独立验证；
2. cases 同时保留失败和后续成功，并明确“差异未被 Trace 捕获”；
3. evidence 公开的是事件范围、摘要承诺和脱敏 excerpt，而不是原始 command/result。

这是 AEN 的渐进披露：先发现 Card，再按 exact Experience digest 和预算读取需要的 section。读取内容不会执行任何操作。

## 10. 你刚刚验证了什么

你已经验证：

- DSH Trace 可以作为证据源接入，但不会被逐条发布；
- Adapter 能选择高价值 Episode；
- Trace 看不到的 Harness/Skill 内容会进入 Evidence Gap；
- Distiller 不能把观察性序列升级成因果结论；
- Experience 默认私有，review 和 Promotion 是不同阶段；
- Consumer 先取 Card，再按 section 读取，不存在远端自动执行。

你**没有**验证：

- 该 recipe 能提升真实 DeepSeek 模型成功率；
- 这个经验适用于另一个 Harness 或仓库；
- fixture 中的 Skill 导致了恢复；
- 真实跨用户公共网络已经完成 Pilot。

这些结论需要 live Manifest、明确 Benchmark、真实模型、baseline/treatment、独立参与者和更高证据级别。

## 11. 可选：把 AEN 安装成 DeepSeek Harness 插件

上面的离线教程不要求本机安装 DSH。要捕获 Trace 中看不到的 live Harness surface，可以把 AEN 打包成 DSH bundle。

在 AEN 仓库根目录：

```sh
mkdir -p .work/releases
pnpm --dir packages/dsh-plugin pack \
  --pack-destination ../../.work/releases
```

然后在已经构建的 DeepSeek Harness 源码目录：

```sh
pnpm dsh plugin --profile web add \
  /absolute/path/to/deepseek-harness-akn/.work/releases/aen-dsh-plugin-0.0.1.tgz
pnpm dsh web
```

如果使用全局安装的 `dsh`，去掉命令前的 `pnpm`。

插件默认配置为：

- 本地 store：当前 workspace 的 `.aen/evidence.sqlite`；
- `captureSkillResources=false`；
- `allowHubSearch=false`；
- `aen-tools` disabled；
- public publishing disabled。

也就是说，安装插件不会自动上传会话、查询 Hub、暴露完整 Skill 或发布 Experience。当前兼容性验证目标为 DeepSeek Harness `0.1.0-rc.7`。完整配置和卸载方法见 [`@aen/dsh-plugin` 说明](../../packages/dsh-plugin/README.md)。

## 12. 下一步

- 阅读[失败恢复示例注解](../../examples/failure-recovery/README.md)，把 CLI 输出映射回协议对象；
- 阅读[项目总览](../overview.md)理解整个网络循环；
- 阅读[Experience 编写与审查指南](../guides/experience-authoring-review.md)处理自己的草稿；
- 编写其他 Harness Adapter 时，继续阅读 [Adapter 编写指南](../guides/adapter-authoring.md)。
