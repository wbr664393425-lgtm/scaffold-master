# 后端架构说明

当前底座使用 Spring Boot 多模块分层，用于后续后台业务开发。

| Maven 模块 | 中文职责 | 主要入口 |
| --- | --- | --- |
| `scaffold-common` | 统一响应、分页、业务异常 | `R`、`PageQuery`、`PageResult`、`BusinessException` |
| `scaffold-framework` | 认证、会话、权限、数据范围、操作审计、异常与请求追踪 | `security`、`datascope`、`audit`、`handler`、`filter` |
| `scaffold-system` | 用户、角色、组织、菜单、字典、参数、日志与工作台；日志统计与当日泳道 | `AuthController`、`SystemManagementController`、`DashboardController`、`MonitorController`、`MonitorStatsService` |
| `scaffold-generator` | 真实表导入、生成配置、预览、ZIP 下载 | `GeneratorController`、`GeneratorService`、`GeneratorMapper` |
| `scaffold-admin` | 启动、配置、初始化工具与集成测试 | `ScaffoldAdminApplication`、`DbInit` |

建筑、工作流模块和 Flowable 依赖已移除。新增业务复用通用模块，不在 Controller 或 Service 重复实现基础安全与返回结构。

## 请求与安全

请求经 TraceId 与 JWT 过滤器进入 Controller → Service → MyBatis Mapper → MySQL，普通 JSON 接口返回 `R<T>`；导出和生成 ZIP 使用文件响应。

- JWT 与 Redis token 必须同时有效，退出撤销当前 token；每次登录的 JWT ID 独立，快速重新登录不会复用已撤销 token。
- JWT 签名密钥通过必填环境变量 `JWT_SECRET` 配置，UTF-8 编码至少 32 字节且不能全为空白；缺失或长度不足会阻止启动，仓库不内置共享签名密钥。
- 登录成功写登录日志并更新 `sys_user.last_login_time`（最近登录时间），用户列表与看板据此展示。
- `/api/health`、验证码与登录可匿名访问，其余接口要求登录。免鉴权接口优先用 `@Anonymous` 标注在 Controller 类或方法上，`PermitAllUrlProperties` 启动时扫描并加入放行列表（路径变量 `{xxx}` 归一为 `*`，兼容 PathPatternParser），不在 `SecurityConfig` 里再手写匹配串。
- 验证码答案只存 Redis（前缀 `captcha:`，5 分钟过期）并在 `verify` 时消费；`CaptchaService` 用 java.awt 无头模式渲染 base64 PNG（随机底色、干扰线噪点、逐字符旋转），不引第三方验证码库，接口不回传明文答案。开关 `scaffold.security.captcha.enabled`（环境变量 `CAPTCHA_ENABLED`）关闭时 `verify` 直接放行，集成测试据此免读图。
- `@RequiresPermission` 校验操作权限；超级管理员直接放行，普通角色必须启用且未删除，停用用户不能获得接口权限。
- 菜单来自真实授权关系；超级管理员读取所有启用且可见的菜单，无需逐项授权新菜单。
- `@DataScope`、`SystemDataScopeResolver` 与 `DataScopeCriteria` 当前接入用户查询和导出，新增业务须按业务表字段显式接入。
- JWT 的 `userId` 声明经 `LoginUser` 挂在 `Authentication#getDetails()` 上，业务代码统一用 `SecurityUtils`（`getUserId` / `getUsername` / `isAuthenticated`）读取当前登录人，不再自行解析请求头。
- `@OperLog` 统一记录写操作及脱敏请求参数；切面会剔除 `ServletRequest` / `ServletResponse` / `MultipartFile` / `BindingResult` / `Model` 这类不可（或不应）序列化的容器对象——导出接口持有 `HttpServletResponse`，序列化会抛 `getOutputStream() has already been called` 并把业务请求带崩；参数记不住时只丢日志内容。客户端 IP 由 `framework/web/IpUtils` 按代理头优先级解析，经反向代理后不会全记成容器内网地址。异常由 `GlobalExceptionHandler` 返回统一错误结构。

## 初始化与时间

`sql/V1__init_schema.sql` 创建 17 张表，`V2__seed_data.sql` 初始化组织、岗位、角色、用户、菜单、字典、参数及生成配置，`V3__system_resource_menu.sql` 追加系统管理「资源监测」页面菜单（ID 108，权限 `system:resource:list`）并补超级管理员(1) 的授权。关联表、日志表与生成字段表可不具备全部四个业务审计字段；其余业务表默认含创建人、更新人、创建时间和更新时间。

SQL 是新项目初始化基线，不是已有业务库的自动升级脚本。`DbInit` 使用进程中的 `DB_*` 变量，按版本顺序导入；参数 `fix` 会删除整个目标库，执行前必须核实库名与备份。

数据库连接信息与 Redis 信息来自环境变量。Hikari 通过独立属性传递 `connectionTimeZone` 和 `forceConnectionTimeZoneToSession`，默认 `+08:00`，避免 URL 中的加号被解码成空格；初始化工具同样使用连接属性，不修改 MySQL 全局时区。强制会话时区影响 `NOW()` 等数据库时间函数，配置含义见 [MySQL Connector/J 官方文档](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-datetime-types-processing.html)。

Jackson 的序列化时区由 `spring.jackson.time-zone`（环境变量 `JSON_TIMEZONE`，默认 `GMT+8`）指定，必须与连接强制的会话时区一致：默认按 UTC 序列化 `java.util.Date` 会让所有时间字段整体早 8 小时，`yyyy-MM-dd` 这类日期直接少一天。只对齐时区、不加 `date-format`，避免改动既有接口的日期线格式。

## 只读统计与资源读数

`ResourceMonitorService` 为「资源监测」页提供单次快照，全部走只读采集、不落库不建表：JMX 取主机 CPU / 物理内存 / 交换 / 磁盘挂载点与 JVM 堆、GC、线程、类加载、文件描述符；Redis 用连接自身的 `INFO` / `PING`；数据库分两块独立降级——HikariCP 的 `HikariPoolMXBean` 给池水位（活跃 / 空闲 / 排队线程 / 上限，**不需要数据库权限**），`SHOW GLOBAL STATUS|VARIABLES` 与 `information_schema.tables` 给会话与容量（**需要 PROCESS 权限**，受限账号下只有这一段降级）。两个平台差异按实测处理：macOS 的 `getCpuLoad()` 恒为 -1，改按两次采样的进程 CPU 时间差 / 墙钟差折算并对全部核归一；整机瞬时值取不到时用 1 分钟负载 / 核数折算并在返回值里标注估算。利用率采不到统一回传 `-1`，由前端显示「—」而不是 0%。字段含义见 `docs/frontend-backend-integration.md`。

`MonitorStatsService` + `MonitorStatsMapper` 提供操作 / 登录日志的概览、按时间桶趋势、当日泳道与登录 7×24 热力（`login-logs/heatmap`，含同 IP / 同账号连续失败 `anomalies` 聚合，阈值读 `sys_config`，缺省 5）；`DashboardService` 补充上一周期登录数、近 7 天按日操作量，`stats` 另含 `menus`（菜单项总数）与 `depts`（部门数），上一周期为 0 时以 `fresh` 标记「新增」；在岗 / 持有人数与数据范围分布只计未删除用户。`SystemManagementService.permissionsGraph` 聚合用户、角色、菜单与两组关联表，供权限溯源视图。用户分页 / 统计 / 导出支持可选 `postId`（经 `sys_user_post` 关联过滤）。统计与聚合全部为只读查询，不改表结构；时间边界取数据库 `NOW()` 后以字符串传参，P95 在 MySQL 5.7 下用 `ORDER BY cost LIMIT 1 OFFSET n` 计算。字段说明见 `docs/frontend-backend-integration.md`。

## 引用选项接口

- `/api/system/users/options` 受用户查询权限保护，返回部门结构；具有用户新增 / 编辑权限才返回角色、岗位选项，具有新增 / 重置密码权限才返回初始密码；不返回部门联系人信息。
- `/api/system/dict/options/{dictType}` 提供已启用字典中的启用选项，仅要求已登录；字典管理接口及写入仍由字典权限保护。

## 当前开发边界

代码生成输出 7 份开发骨架，Controller、Service、Mapper 的业务 CRUD 仍需实现；字段配置目前只展示，表说明和确认标记可保存。ZIP 不会自动写入当前工程。

`sys_file` 为保留表，当前没有完整文件上传接口；统一防重复提交与新增业务的数据权限闭环按具体项目需要扩展。

模块文件、表、接口字段中文说明与排障入口见根目录 `PROJECT_MAP.md`；测试在独立本地校验库执行，避免混入开发库数据。
