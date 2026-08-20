# API Service 版本发布流程

本文定义 `openapi-service` 的版本、Git Tag、GitHub Release 和 GHCR 镜像发布流程。Service 与 Platform 独立发布，版本号不建立对应关系。首个正式公开版本为 `0.1.0`。

## 1. 发布通道

| Git 事件 | GitHub Release | GHCR 镜像 | 用途 |
| --- | --- | --- | --- |
| Pull Request / `main` | 不创建 | `main` 会更新 `latest` 与架构标签 | 开发主线验证 |
| `vX.Y.Z` | 正式 Release + 预编译压缩包 + SHA-256 | `X.Y.Z` 多架构镜像；`latest` 继续保持现有浮动规则 | 正式发布 |
| `vX.Y.Z-rc.N` | Prerelease | 对应预发布标签 | 发布候选 |

Git Tag 必须去掉 `v` 后与 `package.json` 版本一致，指向已经进入远端 `main` 的提交，并且发布后不可移动。

## 2. 自动化工作流

仓库包含三条明确流水线：

- `ci.yml`：Pull Request 和 `main` 的未使用代码检查、类型检查、测试和构建。
- `docker-publish.yml`：为 `main` 与版本 Tag 构建 amd64/arm64 镜像并合并多架构清单。
- `release.yml`：校验版本 Tag，重复执行发布门禁，生成并校验预编译压缩包与 SHA-256，再创建 Release Notes 和 GitHub Release。

GitHub Release 与容器镜像工作流都会由版本 Tag 触发。两条工作流都成功后，该版本才算发布完成。临时基础设施故障可以在 GitHub Actions 中重跑原工作流；若失败来自源码、版本或产物缺陷，应修复后发布新的 patch 版本，不能移动已经公开的 Tag。

## 3. 为什么没有 `pnpm licenses:check`

旧脚本只是一个自建的许可证字符串允许列表，不属于构建或运行需求。它会把未知表达式、双许可证和元数据差异直接当成发布失败，但不能替代真正的许可证与供应链审查，因此从 `0.1.0` 门禁中移除。

依赖合规仍通过以下方式维护：

- 根包明确声明 MIT。
- 锁文件必须提交并由依赖更新 PR 审查。
- 引入具有特殊许可、数据授权或再分发限制的依赖与资产时，在模块文档和 Release Review 中单独记录。
- CI 继续执行死代码检查、类型检查、测试和构建。

如果未来组织确实需要自动化合规，应接入能处理 SPDX 表达式和人工批准记录的正式工具，而不是恢复简单字符串白名单。

## 4. 发布前检查

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
```

同时确认：

- `package.json` 已更新为目标版本。
- `.env.example` 仍只包含必要变量。
- 新增外挂数据遵循 `SERVICE_DATA_DIR/assets/<module-id>` 规范；允许随版本分发的内置资源放在仓库 `resources/<module-id>`。
- OpenAPI 和配置 Schema 变更具有测试与迁移说明。
- 删除 Endpoint 前，Platform 中已有 Route 已先停用。
- Docker amd64/arm64 构建没有引入架构专用遗漏。

## 5. 准备 Release

从最新 `main` 创建发布分支：

```bash
git switch main
git fetch origin
git merge --ff-only origin/main
git switch -c release/v0.1.0
```

更新版本、文档和 Release Notes，完成审查后合并到 `main`。重新同步并确认本地与远端一致：

CI 只允许 `release/v<目标版本>` 分支修改根包版本，避免普通功能 PR 意外推进发布版本。

```bash
git switch main
git fetch origin
git merge --ff-only origin/main
git rev-list --left-right --count HEAD...origin/main
node -p "require('./package.json').version"
```

输出应分别为 `0 0` 和 `0.1.0`。

## 6. 创建 Service Tag

```bash
git tag -a v0.1.0 -m "OpenAPI Service v0.1.0"
git push origin v0.1.0
```

等待以下结果全部成功：

- GitHub Release `OpenAPI Service v0.1.0`。
- `openapi-service-0.1.0.tar.gz` 与 `checksums.txt`。
- `ghcr.io/nuoxiantech/openapi-service:0.1.0` 多架构镜像。
- 浮动的 `latest` 标签仍按现有主线发布规则正常生成；生产部署固定使用 `0.1.0` 或镜像 digest。

## 7. 与 Platform 的兼容验证

Service 与 Platform 是独立部署和发布单元，版本号不建立对应关系。Service 可以因业务接口新增、修复或运行时优化单独发布；Platform 也可以在不发布 Service 的情况下升级。

每次发布只需确认 Service 声明的 `serviceProtocol` 在目标 Platform 的支持集合内（当前为 `openapi-service/v1`），并通过 Platform → Service 集成测试。Platform 工作流验证 Service 当前 `main`，不会根据 Platform 版本选择 Service Tag，也不会比较两边的软件版本号。

业务 Endpoint 的 `/v1`、`/v2` 与控制协议分别演进。新增破坏性业务接口时可以发布 `/v2` 并保留 `/v1` 迁移；只有 `/.well-known/*`、认证或配置同步语义不兼容时，才发布新的控制协议（例如 `openapi-service/v2`）并要求 Platform 增加对应适配。

## 8. 生产发布顺序

首次部署（示例版本号仅代表各自当前发布版本）：

1. 创建私有网络和 Service Token。
2. 启动选定的 Service 版本，验证 `/healthz` 与 `/readyz`。
3. 部署选定的 Platform 版本并应用其数据库迁移。
4. 在 Platform 管理后台创建 Internal Upstream、填写 Token、执行发现和配置同步。
5. 发布 Endpoint 并验证 API Key、日志、统计和积分。

后续兼容升级可以先滚动替换 Service Target，再升级 Platform。若 Release Notes 明确要求相反顺序，以该版本的兼容性说明为准。

## 9. 回滚与发布记录

- Service 代码问题：恢复上一镜像 digest 或发布目录。
- Service 配置问题：由 Platform 重新同步上一期望配置。
- Platform 问题：按 Platform 自己的数据库和应用回滚流程处理。

保留以下发布记录：Tag、Commit、GitHub Actions 链接、镜像 digest、压缩包 SHA-256、控制协议版本、集成测试和生产验证结果。
