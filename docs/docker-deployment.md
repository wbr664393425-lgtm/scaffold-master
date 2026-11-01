# Docker 部署指南

脚手架用一份 Compose 文件编排四个服务：前端 nginx（静态托管 + `/api` 反向代理 + SPA 回退）、后端 Spring Boot jar、Redis、以及可选的内置 MySQL。默认面向单台 Linux/macOS 主机自托管；数据库也可复用宿主机已有实例。

本指南的镜像构建、两种启动模式与文末验证命令均在 macOS（Docker Desktop 29.5.3 / Compose v5.1.4，apple silicon）实测通过，验证记录见文末。

相关文件：

| 文件 | 中文说明 |
| --- | --- |
| `docker-compose.yml` | 服务编排；MySQL 在 `mysql` profile 中，默认不启动 |
| `.env.example` | 环境变量模板，复制为 `.env` 后修改（`.env` 已被 git 忽略） |
| `deploy/mysql-client.cnf` | 内置 MySQL 导入初始化 SQL 时的客户端字符集配置 |
| `scaffold-system/Dockerfile` | 后端镜像：Maven 多阶段构建 → `eclipse-temurin:17-jre` 运行 |
| `scaffold-vue/Dockerfile` | 前端镜像：`node:22-alpine` 构建 → `nginx:1.27-alpine` 托管 |
| `scaffold-vue/nginx.conf` | 静态资源缓存、SPA 回退与 `/api` 反代配置 |

## 前置条件

- Docker Engine（或 Docker Desktop）+ Docker Compose v2，磁盘约 2 GB。
- 三份初始化 SQL 不写 `CHARSET` / `COLLATE`，建表结果继承数据库默认字符集：目标库必须是 utf8mb4（MySQL 5.7 默认可能是 latin1，会让中文直接乱码）。内置 `mysql` 服务已通过启动参数固定 `utf8mb4` / `utf8mb4_unicode_ci`；复用外部实例时先确认库字符集，必要时 `CREATE DATABASE ... CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`。
- 生成 JWT 密钥：`openssl rand -hex 32`（UTF-8 至少 32 字节且不能全为空白）。

## 快速开始（内置 MySQL）

```bash
cp .env.example .env
# 编辑 .env：至少填入 JWT_SECRET，并把 DB_PASSWORD 改成非默认值
docker compose --profile mysql up -d --build
```

`backend` 对 `mysql` 是**可选依赖**（`depends_on` + `required: false`）：启用 profile 时后端会等 MySQL 健康检查通过再启动，顺序确定；不带 profile 复用外部 MySQL 时该依赖自动跳过，不会因为拉起跑一个多余的数据库。Redis 是硬性健康依赖，前端又等后端 `/api/health` 通过才对外发布，因此这条命令返回即代表可访问。浏览器打开 `http://<主机地址>`（端口由 `WEB_PORT` 控制，默认 80）。

数据持久化在命名卷中，卷名格式是 `<project>_<卷名>`，project 默认取所在目录名（在本目录下即 `scaffold-master_mysql-data`、`scaffold-master_redis-data`）。`down` 保留卷，`down -v` 会连数据一起删，不可恢复。

内置 MySQL 仅首次创建卷时导入 `scaffold-system/sql` 下的 `V1`（建表）→ `V2`（种子数据）→ `V3`（资源监测菜单），按文件名排序执行；已有卷不会重跑。

`deploy/mysql-client.cnf` 是必需的：官方 mysql 镜像容器内 locale 为 `C`，导入 SQL 的客户端默认按 latin1 解析 UTF-8 字节，种子中文会被二次编码存库（页面显示成「å‘¨æ˜Žè¿œ」）。这份配置把 `[client]` 字符集固定为 utf8mb4，与 README 要求的 `--default-character-set=utf8mb4` 口径一致。

## 复用宿主机已有 MySQL

已有初始化好的库时，不带 profile 启动，只跑 Redis + 后端 + 前端：

```bash
# .env 中设置：
#   DB_HOST=host.docker.internal   已为 backend 配好 host-gateway 映射，Linux 同样适用
#   DB_NAME / DB_USERNAME / DB_PASSWORD 按实际库配置
docker compose up -d --build
```

外部 MySQL 只监听 127.0.0.1 时容器访问不到，需要先放开监听地址或改走宿主机局域网 IP。

`DB_HOST=host.docker.internal` 与 `DB_PORT` 必须成对设置：`DB_PORT` 是后端实际连接的端口，漏改时它会退回默认 3306，打到宿主机上另一个 MySQL 实例（表现为登录报「系统内部错」而不是连不上内置库）。内置 MySQL 的宿主机映射端口是另一个变量 `MYSQL_HOST_PORT`，走外部模式时两者要指到同一个数字。

外部库不会被自动初始化：需先按 README 的口径导入三份 SQL（客户端带 `--default-character-set=utf8mb4`、会话 `SET time_zone='+08:00'`），或直接用 `scaffold-admin` 里的 `com.scaffold.admin.util.DbInit`（读同一组 `DB_*` 变量）。自动导入只在内置 `mysql` 服务首次建卷时发生。

## 环境变量

| 变量 | 中文说明 | 默认值 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 签名密钥，UTF-8 至少 32 字节且不能全为空白；换密钥会使旧 token 失效 | 必填，无默认值 |
| `WEB_PORT` | 前端站点在宿主机暴露的端口 | `80` |
| `DB_HOST` | MySQL 地址；内置服务名为 `mysql`，外部实例填 `host.docker.internal` | `mysql` |
| `DB_PORT` | 后端连接 MySQL 的端口；内置服务填 `3306`，复用外部实例时填该实例真实端口 | `3306` |
| `MYSQL_HOST_PORT` | 内置 MySQL 映射到宿主机的端口，本机 3306 被占用时只改这一项 | `3306` |
| `DB_NAME` | 数据库名称 | `scaffold_system` |
| `DB_USERNAME` / `DB_PASSWORD` | 数据库账号 / 密码 | `root` / `root`，务必按环境修改 |
| `DB_TIMEZONE` | 数据库连接与会话时区 | `+08:00` |
| `JSON_TIMEZONE` | JSON 序列化时区，须与 `DB_TIMEZONE` 对齐，否则日期整体偏移 | `GMT+8` |
| `CAPTCHA_ENABLED` | 登录图形验证码开关；生产保持 `true` | `true` |

后端与 Redis 的连接在 compose 内固定为 `REDIS_HOST=redis`、`REDIS_PORT=6379`，Redis 未设密码（`REDIS_PASSWORD` 留空），因此 Redis 端口不对宿主机暴露。

## 日常运维

```bash
docker compose ps                        # 各服务与健康检查状态
docker compose logs -f backend           # 跟踪后端日志
docker compose up -d --build             # 代码更新后重建并滚动发布
docker compose down                      # 停止并移除容器，保留数据卷
docker compose --profile mysql down -v   # 连 MySQL/Redis 数据卷一起删除（不可恢复）
```

## 验证方法

```bash
curl http://localhost/api/health                       # {"code":200,...,"data":{"status":"UP",...}}
curl -s http://localhost/api/auth/captcha | head -c 80 # captchaEnabled / uuid / img（base64 PNG）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/system/users   # SPA 深链接回退 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/system/users  # 无令牌 401
docker exec scaffold-master-mysql-1 mysql -uroot -p"$DB_PASSWORD" --default-character-set=utf8mb4 \
  -e "SELECT nickname FROM $DB_NAME.sys_user WHERE username='admin';"        # 应为「周明远」而非乱码
```

浏览器访问 `http://localhost`，用 `admin` / 种子密码登录后应能看到工作台侧栏（工作台、系统管理、系统监控、系统工具）与列表数据。

## 注意事项

- 种子管理员 `admin/admin123` 仅供本地开发；对外暴露前必须改密码，`.env` 里的 `DB_PASSWORD`、`JWT_SECRET` 也不要沿用默认值。
- 内置 MySQL 的健康检查要登录，`docker inspect scaffold-master-mysql-1` 能看到 `DB_PASSWORD`，同机其他用户也能读；本机自托管没问题，多人共享的主机请改用外部 MySQL（不带 profile），健康检查就不会带凭据。
- 前端登录页的验证码答案只存 Redis、不回传明文，自动化验证需要绕过时把 `CAPTCHA_ENABLED=false`（后端集成测试即以此关闭），验完记得改回 `true`。
- 80 端口被本机其他 Web 服务占用时改 `WEB_PORT`；Linux 上非 root 用户默认不能绑定 1024 以下端口。
- 前端镜像构建内置 `vue-tsc` 类型检查，类型错误会导致构建失败，这是预期行为。
- `restart: unless-stopped` 让宿主机重启后服务自动恢复；Docker Desktop 需设置为开机自启才会拉起整栈。
- `/api/health` 只证明后端进程活着，**不探测数据库与 Redis**，所以 healthy 不等于数据链路可用。内置 MySQL 模式下启动顺序已由可选依赖保证；外部模式下若数据库比后端晚就绪，或数据库中途重启，最早的几个业务请求会拿到 500，Hikari 是懒初始化、随后自动恢复，排查时看 `docker compose logs backend` 里的 `HikariPool-1 - Start completed`。
- 本指南覆盖单主机自托管，不含域名、TLS 与多副本编排；生产环境建议前面再加一层带证书的 nginx/负载均衡。

## 受限网络下的构建（本机等）

Docker 守护进程不读宿主机 shell 的代理变量，`docker build` 拉基础镜像可能直连失败。两条出路：

1. 配国内加速器：在 `~/.docker/daemon.json` 加 `"registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"]`，然后 `docker desktop restart` 生效。
2. 在 Docker Desktop → Settings → Resources → Proxies 填本机代理（`ProxyHTTPMode` 需为 `manual`，仅写 `HttpProxy` 不生效）。

## 验证记录（2026-11-01）

全部用独立 project name、独立卷、错开端口（`WEB_PORT=80/8181/8182/8183/8186`、`MYSQL_HOST_PORT=3316~3322`）跑通，**未读写本机业务库 `scaffold_system`**；结束后已 `down -v` 清理容器与卷，本机 `scaffold-mysql`、`dsh` 容器状态正常。

- 两个镜像构建成功：后端 471 MB、前端 77 MB；`docker compose config` 在带 / 不带 `mysql` profile 下均校验通过。
- **按本指南原文跑一遍**：`cp .env.example .env` + 改 `.env` + `docker compose --profile mysql up -d --build`（默认 project name、默认卷名 `scaffold-master_mysql-data`），四个容器全 healthy，登录与列表查询通过，文末「验证方法」的每条命令逐条照做均得到预期输出。
- **文档默认形态**（`--profile mysql` + `WEB_PORT=80`）整套拉起：mysql / redis healthy → backend healthy（`restarts=0`，日志零条 `Connection refused`）→ frontend 绑定 80 端口 running。
- **外部 MySQL 形态**（`DB_HOST=host.docker.internal`、`DB_PORT=3321` 配 `MYSQL_HOST_PORT=3321`）在容器内直接调用登录接口通过，`sys_login_log` 真实落库，证明两个端口变量成对设置后连接路径正确；不带 profile 单起 `redis backend` 时 MySQL 不会被可选依赖反向拉起。
- `/api/health` 返回 `status=UP` 且时间为 `+08:00`；`/api/auth/captcha` 返回 `captchaEnabled=true` 与 base64 PNG；缺验证码登录被拒（`code=400 验证码错误或已过期`）；无令牌访问列表接口 401；SPA 深链接 `/system/user`、`/tool/generator`、`/monitor/operlog` 均回退 200。
- 关掉验证码后完成真实登录：取到 token、`/api/auth/me` 返回 35 条权限、`/api/auth/routes` 返回 `/dashboard`、`/system`、`/monitor`、`/tool` 四个顶级路由、`/api/system/users` 返回 3 条种子用户、导出接口返回 `text/csv` 带中文表头与中文数据。
- 浏览器实测：登录页填账号密码 → 工作台侧栏渲染出全部菜单与「中午好，周明远」→ 用户管理表格渲染「周明远 / 平台架构部 / 超级管理员 / 2026-11-01」，控制台无任何报错。验证码开启形态下另测登录页，`img` 元素实际渲染出 130×44 的 `data:image/png` 验证码图。
- 字符集回归：加 `deploy/mysql-client.cnf` 前 `sys_user.nickname` 入库为 `C3A5E28098…`（双重编码，页面显示乱码）；加后为 `E591A8E6988EE8BF9C`，与「周明远」的 UTF-8 字节完全一致，`@@character_set_database=utf8mb4`、排序规则 `utf8mb4_unicode_ci`，三份 SQL 导入后 `sys_menu` 39 行、`sys_dict_data` 7 行。
