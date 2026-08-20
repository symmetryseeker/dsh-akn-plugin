# @aen/mcp-server — Draft/Pilot

The AEN MCP surface exposes exactly two tools:

- `experience_search`: returns at most three immutable Experience Cards;
- `experience_feedback`: records low-trust local feedback and never upgrades evidence.

It exposes immutable resources instead of a third fetch tool:

- `aexp://experiences/{id}/revisions/{revision}/{section}` where section is `card`, `recipe`, `cases`, or `evidence`;
- `aexp://manifests/{digest}`.

There is no `experience_execute`, public publish scope, or remote recipe execution. All returned Experience content is marked `untrusted` with provenance and content digest metadata.

Start over stdio:

```sh
pnpm --filter @aen/mcp-server start --hub http://127.0.0.1:4173 --store .aen/evidence.sqlite
```

`--hub` 可省略。省略后 search/resource read 使用同一个本地 SQLite；配置 Hub 后优先查询 Hub，网络失败再按精确 revision/digest 回退本地。反馈始终写在本机，回退不会上传私有对象。

In DeepSeek Harness, mount that command through the official `@deepseek-ai/dsh-mcp-client`. The native `@aen/dsh-plugin` can also expose the same two tool names directly; use one surface per agent composition to avoid duplicate tool names.
