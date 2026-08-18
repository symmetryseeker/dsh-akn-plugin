# dsh-akn-plugin

**Agent Knowledge Network (AKN) for DeepSeek Harness** — 让每个 DSH Agent 的每一次工具调用，都成为一条可检索、可验证、可共享的知识。

_A Cordis plugin that turns every tool call into a searchable, verifiable, shareable knowledge object, giving all your DeepSeek Harness agents a shared memory and collaboration bus._

---

## 为什么值得用？ / Why use this?

### 问题 / The problem

| 痛点 | 你遇到的场景 |
|---|---|
| **Agent 重启即失忆** | 每次新会话，Agent 不记得昨天踩过的坑 |
| **知识不可信** | Agent 声称的"经验"可能是幻觉，没人验证过 |
| **重复踩坑** | 三个 Agent 各犯一遍同样的错 |
| **Token 烧钱** | 检索知识时把大段内容全拉回来，成本失控 |

### 解决方案 / The solution

**AKN 把 Agent 的知识变成资产，而不是聊天记录。** 每个工具调用（成功或失败）自动入库为一条**内容可寻址、不可变**的知识对象（KO）；任何 Agent 可以检索它、验证它、引用它；一个事实被证伪时，所有依赖它的知识**自动级联失效**。

> **关键区别**：这不是又一块"记忆存储"，而是一张**知识网络**——知识之间互相依赖，证据和信任可以被图传播。这正是 AKN 与 mem0 / 传统记忆方案的核心差异。

| 对比 | 传统记忆 | AKN |
|---|---|---|
| 知识来源 | 手动记录/对话摘要 | **自动采集每一次工具调用** |
| 去重 | 靠关键词 | 内容寻址（sha256），同内容天然同地址 |
| 可信度 | 谁写的算谁的 | 可复现的验证记录，验证与内容分离 |
| 证伪传播 | 无 | **依赖感知的级联失效**（BFS 图传播） |
| Token 成本 | 检索带回大段内容 | 默认只返回 `id/title/summary/status/environment` |

---

## 用途 / Use cases

- **个人 Agent 长效记忆**：跨会话记住项目约定、踩坑记录、常用命令，不再每次重头问。
- **多 Agent 协作知识共享**：Agent A 的失败经验自动成为 Agent B 的避坑指南（协作总线）。
- **团队知识库**：把验证过的工具用法、环境兼容性沉淀成团队共识，新人/新 Agent 秒上手。
- **可审计的 Agent 行为**：每次工具调用都留下不可篡改的记录与验证链，可复盘。

---

## 核心特性 / Features

| 特性 | 说明 |
|---|---|
| 🪝 **工具调用即知识** | 监听 `tool/after` / `tool/error` 自动采集，**绝不打断 Agent 主流程**（try-catch 隔离，且不采集 AKN 自身工具，防自我污染） |
| 🔒 **内容可寻址、不可变** | `KO.id = sha256(JSON.stringify(body))`；改 body 即新 ID，旧版本永远保留溯源 |
| 🛡️ **可插拔验证** | `akn_verify` 追加可复现的 VerificationV1 记录；信任依赖验证，不依赖发布者权威 |
| ⚡ **级联失效** | 证伪一个事实 → 所有直接/间接依赖它的知识自动降为 `needs_verification` |
| 💰 **Token Economy** | `akn_search` 默认只返回精简字段，`includeBody: true` 才拉全文 |
| 🔌 **协作总线** | `ctx.provide('akn', service)`，任何插件可 `ctx.akn.search()` |

---

## 愿景：从本地备忘录到开放基础设施 / Vision: from local memo to open infrastructure

AKN 当前是**本地优先、私有**的——每个 Agent/用户的 AKN 是一个"孤岛"。这是刻意为之（隐私、离线、零服务器），但它有两条**为未来铺好的路**：

_Today AKN is local-first and private by design. Two architectural choices already lay the groundwork for becoming shared infrastructure — not just a local memo._

### 1️⃣ 内容寻址 = 无冲突联邦 / Content addressing = conflict-free federation

**EN.** `id = sha256(body)` + immutable content + append-only verification means
merging two AKNs is **idempotent** (same content ⇒ same id), with no conflict
resolution. The "island" is connectable without loss — the foundation for a
public knowledge base.

**中文.** `id = sha256(body)` + 内容不可变 + 只追加验证 ⇒ 两个 AKN 合并**幂等**
（同内容必同 id），无需冲突解决。"孤岛"可无损连通——公共知识库的地基。

### 2️⃣ 核心层零框架依赖 / Core layer is framework-agnostic

**EN.** `core/` (types/storage/service) depends only on `zod` + `node:crypto` —
the DSH coupling lives only in a thin adapter. The protocol is portable.

**中文.** `core/` 层只依赖 `zod` + `node:crypto`；DSH 耦合只在薄适配层。协议可移植。

### 开放路线图 / Open roadmap

| Phase | 范围 / Scope | 时机 / When |
|---|---|---|
| **0** | 签名验签（联邦信任前提）+ 本地导出/导入 | 现在 / now |
| **1** | 抽 `akn-core` npm 包 → HTTP 服务（REST）→ **MCP 服务器**（任何支持 MCP 的 Agent 可接入：Claude / Cursor / LangChain 等） | 验证后 |
| **2** | 命名空间 `ns:<org>/<space>` + 联邦同步（git 式 push/pull） | 社区级 |

**协议不变式 / Protocol invariants**（无论什么框架都守着三个动词 + 内容寻址）：

```
POST /v1/publish    {title, summary, body, links?} → {id, status}
GET  /v1/search     ?keyword=&type=&status=&tags=    → slim hits
POST /v1/verify     {targetId, verifierDid, signature, verdict, evidence}
GET  /v1/ko/:id                                      → full KO
```

**中文.** 从"本地备忘录"到"学术圈/公共知识库"的路径：先守住本地优先 + 内容寻址，验证价值后通过 REST/MCP 开放协议脱离 DSH 锁定，最后以命名空间 + 联邦同步连成网络。

---

## 快速开始 / Quick start

### 前置要求 / Prerequisites

- DeepSeek Harness (DSH) 已安装，`dsh` 命令可用
- Node.js ≥ 18

### 安装 / Install

```sh
# 方式 A：从 npm 安装（发布后）
dsh plugin --profile web add dsh-akn-plugin

# 方式 B：从 GitHub 安装
dsh plugin --profile web add github:symmetryseeker/dsh-akn-plugin

# 方式 C：本地目录开发
dsh plugin --profile web add /path/to/dsh-akn-plugin
```

> 首次安装若提示 `ERR_PNPM_IGNORED_BUILDS`：编辑 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`，把 `allowBuilds` 下对应项改为 `true`，再重跑一次即可。

### 启动 / Start

```sh
dsh web        # 打开 Web UI，默认 http://127.0.0.1:3080
```

启动日志出现以下内容即说明 AKN 已加载（无报错）：

```
[akn] ...      （如有 debug 日志）
dsh web: http://127.0.0.1:3080
```

### 验证 / Verify

在 Web UI 新开一个 Agent 会话，直接让 Agent 调用（前提：已在设置里配好模型 Key）：

```
用 akn_search 搜索 "glob" 相关的知识，并汇报结果。
```

插件冷启动时已注入 **23 条种子知识**（glob 反斜杠、fs 编码、fetch 超时、连接池等真实坑），所以第一次搜索就会有结果。

---

## 怎么用 / How to use

AKN 暴露 **3 个 Agent 工具**：

### `akn_search` — 检索知识

```
akn_search(query={filters:{type,status,tags}, keyword}, options={limit, includeBody, driftCheck})
```

- 默认只返回 `id / title / summary / status / environment`（省 token）
- 结果按可信度硬排序：`verified > proposed > needs_verification > stale > draft > refuted`

**示例**：
```
akn_search({ query: { keyword: "内存溢出" }, options: { limit: 5 } })
→ [{ id, title, summary, status, environment }, ...]
```

### `akn_publish` — 发布知识

```
akn_publish({ title, summary, body, links?, tags?, status? })
→ { id, status, inheritedInvalidation }
```

- `id` 由 `body` 的内容哈希自动生成，重复发布同内容不会产生重复记录
- 发布者只能声明 `draft` / `proposed`；`verified` 等状态只能由验证产生（信任模型）
- 若 `links.basis` 里的上游已被证伪，新知识自动降级为 `needs_verification`

### `akn_verify` — 验证知识

```
akn_verify({ targetId, verifierDid, verdict, evidence })
→ { targetId, status, verifications, invalidated }
```

- `verdict: true` → 标记 `verified`
- `verdict: false` → 标记 `refuted`，并**级联失效**所有直接/间接依赖它的知识

---

## 配置 / Configuration

默认配置开箱即用。需要调整时，在 profile 的 `cordis.patch.yml` 追加：

```yaml
- apply:
    plugins:
      akn:
        autoPublish: true            # 是否自动采集工具调用
        bootstrapSeeds: true         # 冷启动注入 23 条种子
        bootstrapTasks: true         # 注入 3 条悬赏任务
        searchDefaultLimit: 20       # akn_search 默认结果上限
        driftCheckOnSearch: false    # 搜索时是否自动标记环境漂移
        statusRank:
          verified: 0
          proposed: 1
          needs_verification: 2
          stale: 3
          draft: 4
          refuted: 5
```

---

## 开发 / Development

```sh
npm install          # 安装依赖
npm run build        # tsc → lib/
npm run typecheck    # 类型检查
npm test             # 运行冒烟测试（20 项：内容寻址/级联失效/Token Economy）
node smoke-test.js   # 或直接运行
```

---

## 架构 / Architecture

```
src/
├── index.ts            # 唯一入口：Storage → Service → Tools → Listeners → 种子 → ctx.provide('akn')
├── core/
│   ├── types.ts        # Zod 宪法（status 6 值、environment、links、body 判别联合）
│   ├── storage.ts      # 内容寻址 Map + reverseIndex 反向索引
│   └── service.ts      # publish/search/verify/级联失效/环境漂移
├── tools/              # akn_search / akn_publish / akn_verify（defineTool + JSON Schema）
├── listeners/          # auto-capture.ts（tool/after + tool/error → 自动入库）
└── bundles/            # seed.ts（23 条对抗种子）+ tasks.ts（3 条悬赏）
```

---

## License / 许可

MIT — 自由使用、修改、商用，保留版权声明即可。
