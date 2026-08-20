# 示例：DeepSeek Harness 失败恢复

这个示例展示 AEN 怎样从一段“失败后成功”的 Trace 中提炼出谨慎、可审阅的经验，同时拒绝三个常见错误：

1. 不把每个工具调用都变成公共知识；
2. 不把事件顺序写成因果结论；
3. 不因为 Trace 提到 Skill，就声称知道完整 Harness 配置。

## 示例资产

| 文件 | 作用 |
| --- | --- |
| [`fixtures/dsh/failure-recovery-skills.session.jsonl`](../../fixtures/dsh/failure-recovery-skills.session.jsonl) | 21 条脱敏合成 DSH 事件，包含 Skill 可见性和一次失败恢复 |
| [`experience-card.example.json`](./experience-card.example.json) | 经过本地闭环后，消费者首先看到的 Card 投影 |
| [本地闭环教程](../../docs/tutorials/deepseek-harness-local-loop.md) | 从空临时库产生这些对象的可复制命令 |

这个目录不复制原始 fixture，也不提交生成的 SQLite，避免出现两个会漂移的事实来源。

## 输入里实际发生了什么

session 的关键顺序是：

```text
request/header
  ├─ model: deepseek/deepseek-reasoner
  ├─ tools: skill, bash
  └─ skill catalog: documents, security-review

assistant loads documents skill
assistant calls bash ──► failed result
assistant calls bash ──► successful result
turn completed
```

Trace 同时提供了有用事实和明显缺口：

| Trace 能支持 | Trace 不能支持 |
| --- | --- |
| 同一 episode 中有一次失败和一次后续成功 | 中间哪个改变导致成功 |
| request header 中声明了 Model 和工具 surface | 完整 system prompt、policy 和 live registry |
| catalog/调用中出现两个 Skill | Skill scripts、references、assets、依赖、许可和完整版本 |
| token、latency、tool failure 等运行指标 | recipe 对其他任务和环境的泛化能力 |

因此 Adapter 生成 `trace_only` Manifest，Distiller 只允许形成 observational H1 claim。

## 生成的对象图

当前 fixture 的内容摘要是确定的，因此核心 ID 在不同机器上保持一致：

```text
session sha256:75380a21…
   ├─ HarnessManifest sha256:a315b190… (trace_only)
   └─ TaskEpisode urn:aen:episode:dsh:946181182c9e9fdb0d99a4fd
        ├─ TraceEvidence sha256:f42b862f…
        ├─ Observation sha256:c737c4a7…
        └─ EvidenceGapReport sha256:99d48eb3…
                 │
                 ▼
      ExperienceRevision
      urn:aen:experience:dsh:recovery:5b451faa68147f94cd05223b
      revision 1 / private / H1
```

完整 digest 可以通过教程中的 `inspect`、`distill` 和 `fetch` 命令查看。这里缩写 digest 只用于解释关系，不能用于协议引用。

## Experience 到底说了什么

### Claim

> 在已记录的配置 cell 中，一次失败的 bash result 后出现了成功 result；Trace 不能确定哪个 intervention 导致恢复。

这比“修改后重试能修复 bash”更弱，但它是证据真正支持的范围。

### Recipe

1. 保留并分类本地失败证据；
2. 重试前明确记录一个针对失败的纠正；
3. 只有在任务预算、权限和副作用策略允许时才重试；
4. 独立验证任务验收条件，不把“工具没有报错”直接当作任务成功。

### Stop conditions

- 权限或批准被拒绝；
- 操作具有破坏性但没有显式授权；
- 相同失败重复出现且没有新证据。

### Positive / negative case

正例是后续调用没有记录 tool error；反例是前一次调用失败，任务尚未达到恢复验收边界。案例明确说明两者之间的 corrective intervention 没有被捕获。

## 怎样读 Card

[`experience-card.example.json`](./experience-card.example.json) 是搜索结果的小型摘要，不是可执行 recipe，也不是独立持久化的知识 claim。

几个关键字段：

- `digest` 精确绑定 Experience revision；后续 section 必须按这个身份读取；
- `compatibility: unknown` 表示示例搜索没有提供当前 Model/Harness cell，系统没有猜测匹配；
- `maxEvidenceLevel: H1` 阻止消费者把它当成对照试验；
- `outOfScopeSummary` 和 `knownFailureSummary` 在读取正文前就展示风险边界；
- `availableSections` 与 `estimatedSectionTokens` 让客户端先做 Context Plan；
- `scoreExplanation` 解释它为何进入结果，而不是只返回一个不透明分数。

## 对照示例：普通成功不会自动产生 Experience

仓库还有一份只有普通成功的 fixture：

```text
fixtures/dsh/ordinary-success.session.jsonl
```

用一个新的临时 store 导入：

```sh
aen_ordinary_dir=$(mktemp -d "${TMPDIR:-/tmp}/aen-ordinary.XXXXXX")
node apps/cli/dist/main.js import dsh \
  fixtures/dsh/ordinary-success.session.jsonl \
  --store "$aen_ordinary_dir/evidence.sqlite"
node apps/cli/dist/main.js episode list \
  --store "$aen_ordinary_dir/evidence.sqlite"
```

当前实现会报告：

```json
{
  "normalizedEventCount": 10,
  "episodeCount": 0
}
```

这组正反输入体现了候选选择原则：不是所有成功都值得沉淀，更不是所有 tool call 都要进入网络。

## 可以继续做的三个练习

1. 用 `review --export-edit` 导出下一 revision，把“操作风险分类未知”写成更窄的适用边界，再用 `--replace` 导入；
2. 比较离线 `trace_only` Manifest 和安装 DSH 插件后捕获的 live Manifest，观察 Skill coverage 与 configuration identity 的变化；
3. 为失败恢复建立 Benchmark 和 baseline/treatment，而不是继续堆更多 observational Trace，看看何时才有资格提高 H-level。

做练习时继续使用私有临时 store。只有完成脱敏、许可、引用闭包、人工审阅和签名后，才应考虑显式 Promotion。
