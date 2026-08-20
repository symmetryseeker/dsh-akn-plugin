# AEN Reference Hub — Draft/Pilot

Reference Hub 是 Git-reviewed public AEXP objects 的 PostgreSQL 投影和只读 HTTP/Web 服务。它没有 DeepSeek Harness、Agent loop、远程命令或 Experience 执行权限。

## Portable production directory

先构建依赖，再由 pnpm 生成闭合部署目录：

```sh
pnpm typecheck
pnpm --filter @aen/hub-app build
pnpm deploy:hub -- /absolute/path/to/aen-hub
```

部署命令拒绝覆盖已有目录，并把 Apache-2.0 `LICENSE` 放进发布物。仓库启用了 injected workspace packages，因此部署目录中的 `@aen/*` 依赖会复制到自己的 `node_modules`，不会符号链接回 monorepo。`pnpm test:hub-deployment` 会把该目录建在仓库外，检查所有 symlink 均留在部署根内，再用临时 PostgreSQL 运行 Git ingest、HTTP search、exact-digest read 和 Web E2E。

启动：

```sh
DATABASE_URL=postgresql://... \
AEN_HUB_ADMIN_TOKEN=... \
AEN_GIT_ROOT=/srv/aen/contributions \
AEN_AUTHORIZED_KEYS=/srv/aen/contributions/authorized-keys.json \
node /absolute/path/to/aen-hub/dist/main.js serve --host 127.0.0.1 --port 4173
```

`AEN_GIT_ROOT` 与 `AEN_AUTHORIZED_KEYS` 必须同时设置。若两者都未设置，Hub 只使用数据库现有投影，不会从未验证目录自动导入。

## Container

仓库根目录的 `Dockerfile` 使用同一 portable deploy 产物；`compose.yaml` 提供 PostgreSQL 17、只读 Hub 容器、只读 contribution mount、健康检查和必填管理密钥：

```sh
export AEN_POSTGRES_PASSWORD='generate-a-strong-secret'
export AEN_HUB_ADMIN_TOKEN='generate-a-separate-strong-secret'
docker compose up --build
```

对公网开放前仍必须配置 TLS reverse proxy、访问日志/告警、备份、密钥轮换、速率限制和独立安全审查。Compose 是可重现的单节点 Pilot 起点，不等价于 Stable、联邦或托管服务。
