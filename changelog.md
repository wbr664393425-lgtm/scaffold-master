# Changelog

## 2026-11-01（从业务工程回迁框架通用能力）

- **背景与口径**：以下能力在实际业务工程（网约车运营平台）上先落地并验证，本库原先只有精简版本。本次只搬**与业务无关的框架层**：全局修复与健壮性、系统管理新增页、组件库补齐；不搬业务模块、厂商 SDK（阿里云 OSS / 短信 / 一键登录）与 Excel/Pdf 导出工具链，因此**没有新增任何 Maven 依赖**。
- **图形验证码不再回传明文**：`CaptchaService` 改为 java.awt 无头渲染 base64 PNG（随机底色 + 干扰线噪点 + 逐字符旋转，不引第三方验证码库），答案只存 Redis 并在 `verify` 时消费；响应字段由 `uuid + code` 改为 `captchaEnabled`（是否启用验证码）、`uuid`（校验标识）、`img`（base64 PNG 图片），`code` 明文彻底不出服务端。新增开关 `scaffold.security.captcha.enabled`（环境变量 `CAPTCHA_ENABLED`，默认开启）；`scaffold-admin` 的 surefire 以系统属性关闭验证码，`TestAuthClient` 改为断言关闭状态并提交空验证码，避免集成测试读图。新增 `CaptchaServiceTest` 三条用例覆盖「只回图片、按 Redis 答案校验并删除、关闭时不落 Redis 且直接放行」。
- **令牌携带用户 ID**：新增 `LoginUser`（用户 ID + 账号），`JwtService.parsePrincipal` 解析 `userId` 声明，`JwtAuthenticationFilter` 把它放进 `Authentication#getDetails()`；新增 `SecurityUtils` 统一读取当前登录人（`getUserId` / `getUsername` / `getLoginUser` / `isAuthenticated`），业务代码不再自行解析请求头。
- **`@Anonymous` 免鉴权白名单**：新增 `@Anonymous` 注解与 `PermitAllUrlProperties`，启动时扫描标注的 Controller / 方法，把路径变量 `{xxx}` 归一为 `*` 后加入 Spring Security 放行列表（兼容 PathPatternParser）；`SecurityConfig` 消费该列表。回迁时把原实现的 `commons-lang3` `RegExUtils` 换成 JDK 正则替换，保持零新增依赖。
- **操作日志不再拖垮业务请求**：`OperationLogAspect#params` 原先直接 `valueToTree(joinPoint.getArgs())`，导出 / 下载类接口持有 `HttpServletResponse` 时抛 `getOutputStream() has already been called`，异常处理器又想用 JSON 写回已预设为附件的响应，形成二次失败。现剔除 `ServletRequest` / `ServletResponse` / `MultipartFile` / `BindingResult` / `Model`，并把兜底从只捕 `JsonProcessingException` 扩到 `IllegalArgumentException | IllegalStateException`：参数记不住时只丢日志内容。客户端 IP 改由新增的 `framework/web/IpUtils` 按代理头优先级解析（原来是直接取 `request.getRemoteAddr()`，经 Nginx 后全记成容器内网地址）。
- **日期不再整体早 8 小时**：新增 `spring.jackson.time-zone: ${JSON_TIMEZONE:GMT+8}`。数据库连接把会话时区强制成 `+08:00`，而 Jackson 默认按 UTC 序列化 `java.util.Date`，`yyyy-MM-dd` 这类跨天字段会直接少一天；只对齐序列化时区，不加 `date-format`，避免改动既有接口的日期线格式。
- **页面过渡卡死修复**：多根页面（`ListPage` 与 `FormDialog` / `Drawer` 是兄弟节点）在 `<Transition mode="out-in">` 下没有元素根，leave 钩子不执行导致 `isLeaving` 永真、新路由渲染成注释占位，enter 钩子也从不触发使 `.reveal` 停在 `opacity: 0`（DOM 有内容但肉眼是白屏）。`AppShell.vue` 在 `<component :is>` 外补一层 `.route-frame` 元素根；`motion.ts` 新增 `pageRootOf` 把动画与 `is-entrance-ready` 落回容器内的 `.page`，`pageEnter` / `pageLeave` 加幂等 `finish()` 与兜底定时器，补间被打断也一定放行 `done()`；`ListPage` 自带 `onMounted(() => revealPage(root))` 兜住片段根场景。
- **宽表格可用**：`DataTable` 外包 `.table-shell`，用 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` 隐藏常驻横向滚动条（滚动能力不变：触控板横扫、Shift + 滚轮、触屏拖动照常），横向滚动后给外壳加 `is-hx-scrolled`；勾选列 `.col-check` 改 `position: sticky; left: 0` 与右侧操作列对称，吸附列补 `--surface-solid` 底色与 `tr:hover` / `tr.is-selected` 叠色，并加一条 `inset -1px 0 0 var(--line)` 内阴影提示左侧已吸附。`.content` 由 `overflow-x: clip` 改 `auto` 并补 `min-width: 0`（`.route-frame` 同步），内容真超宽时由内容区兜底横滚而不是被深色外框裁掉。
- **组件与交互补齐**：新增 13 个 UI 组件（`DateInput`、`DateRangePicker`、`Textarea`、`NumberInput`、`TreeSelect`、`Tabs` / `TabPane`、`Upload`、`Photo`、`ImageField`、`Descriptions` / `DescriptionsItem`）与 `RowActions` / `RowMenuItem`（行内前若干动作平铺、其余收进 teleport 到 body 的「更多」菜单，表格横滚与 overflow 裁剪都盖不住）、`popover` / `dateValue` / `upload` 三个 composable；`Panel` 增 `padded` 启用原本闲置的 `.panel-body`；`TrendChart` 增可选 `max` 锁定纵轴上限（百分比序列自适应会抬到 150% 这种读不通的刻度，不传时行为不变）；`PermissionButton` 在只给 `label` 未给 `icon` 时按文案取默认图标，避免行操作全体退化成三个点；`http` 增 `downloadForm`（导出接口以 POST + 表单参数接收查询条件）并抽出共用的 `readBlob`。业务词表（打款、轨迹详情等）与高德地图工具不随组件库带入底座。
- **新增页面免登记**：`composables/auth.ts` 的 `COMPONENT_MAP` 改为 `COMPONENT_ALIAS` + `import.meta.glob('../views/**/*.vue')` 约定解析——底座既有 11 个页面因文件名与 `sys_menu.component` 不同名保留显式别名，其余按 `views/<component>.vue` 自动解析，新增页面不再改这个文件；路由构建时解析不到加载器的条目直接跳过，避免注册出空白路由。
- **系统管理新增「资源监测」**（`/system/resource`，权限码 `system:resource:list` 查询资源实时读数）：后端 `ResourceMonitorController` + `ResourceMonitorService` 全部只读采集、不落库不建表——JMX 取主机 CPU / 物理内存 / 交换 / 磁盘挂载点与 JVM 堆、GC、线程、类加载、文件描述符，Redis 走连接自身的 `INFO` / `PING`，数据库读 HikariCP `HikariPoolMXBean` 池水位（活跃 / 空闲 / 排队线程 / 上限，**不需要任何数据库权限**）与 `SHOW GLOBAL STATUS|VARIABLES`、`information_schema.tables`（需要 PROCESS 权限，受限账号下只有这一段降级）。利用率一律回传 `-1` 表示采不到，页面显示「—」而不是 0%；macOS 上 `getCpuLoad()` 恒为 -1，改按两次采样的进程 CPU 时间差 / 墙钟差折算，整机取不到时用 1 分钟负载 / 核数折算并在页面标注「按负载折算」。前端 `views/system/resource/index.vue` 沿用非列表页骨架（`PageHeader` → `.stack` → 多个 `Panel`），5 秒自动刷新、页面切后台即暂停、卸载清理定时器；`sql/V3__system_resource_menu.sql` 在系统管理(100) 下新增页面 108，仅授予超级管理员(1) 与系统管理员(2)。
- **品牌只搬结构**：登录页左侧介绍位与页脚版权 / 备案改为读 `APP.platform`（眉标、主标语、说明句）、`APP.company`、`APP.beian`（新增 `BeianItem` 备案条目类型），960px 以下画布不再整块隐藏而是退化成一条备案页脚；`APP.copyright` 已无引用故删除。本库取值保持通用口径（不写公司名与备案号，`beian` 为空数组），重置密码默认值仍为 `Yy@123456`，`index.html` 标题不动。
- **有意不搬**：业务模块与业务页面、厂商 SDK 与对应配置键、Excel 导出与 POI 工具链、RuoYi 风格的 `scaffold-common` 全量工具类。两处即使搬过来也没有调用方，因此确认不做：`PageQuery.orderByClause` 排序白名单（当前所有 Mapper 都是静态 `ORDER BY`，没有拼接入口）、`views/system` 七个管理页（两边代码本就逐字相同，无差异可迁）。
- **验证**：后端 `mvn -pl scaffold-framework -am test` 通过 11 项（公共模块 4、`JwtServiceTest` 4、新增 `CaptchaServiceTest` 3），`mvn -pl scaffold-admin -am package -DskipTests` 打包通过；前端 `npm ci`、`npm run test:unit` 21 项通过、`npm run build`（含 `vue-tsc --noEmit`）通过，产物中可读到资源监测页与 `/system/resource` 请求。随后在同一 docker MySQL 实例上另建独立校验库（导入 V1/V2/V3，17 张表，避开业务工程在用的开发库），`mvn -pl scaffold-admin -am test` 通过 **57 项**（common 4 + framework 7 + admin 集成 46，0 失败 0 跳过）：46 项全部经由 `TestAuthClient` 登录，等于「surefire 注入验证码关闭 + 夹具断言关闭态并提交空验证码」这套新契约经真实 Spring 上下文跑通，`OperationLogAspectApiTest` 2 项同时确认切面剔除容器对象后审计仍能正常写库。浏览器实测记录：资源监测页 8 个面板与真实读数（物理内存 99.1% 判「紧张」、Hikari `active 0 / idle 10 / max 10 / awaiting 0`、MySQL 会话 20/151）随 5 秒自动刷新递进；`.route-frame` 存在且页面 `opacity: 1` / `transform: none`、`.reveal` 无残留隐藏；用户列表表格内容 1040px 而容器 732px，`scrollLeft = 240` 后外壳拿到 `is-hx-scrolled`、勾选列出现内阴影；未显式传 `icon` 的 `PermissionButton` 按文案取到 edit / trash；无效令牌访问 `GET /api/system/resource` 返回 401。页面实测还发现资源监测页脚说明引用了未迁入本底座的「基础设施 · 服务器信息」静态台账页，已删除该半句。`scaffold-vue/scripts/session-regression.py` 回归脚本本身未执行。

## 2026-10-11（MIT 开源发布）

- 以当前代码建立独立的公开版本快照，采用 MIT License；第三方依赖保留各自许可，README 单独说明 GSAP 许可。
- 开源内容保留前后端源码、测试、初始化 SQL、锁文件、必要开发脚本及当前架构文档；排除宣传视频、旧规划、编辑器配置、依赖、构建产物、缓存、日志、备份和私密配置。
- JWT 密钥改为必填环境变量 `JWT_SECRET`，启动时校验 UTF-8 编码至少 32 字节且不能全为空白；新增无需数据库和 Redis 的密钥边界与签名验证测试。
- 初始化示例电话留空，示例邮箱改用 `example.com`；清理公开文档中的本机绝对路径和已排除目录入口，保留历史日志与人工备注。
- 发布整理仅作用于独立副本，原项目工作区及本地提交历史保留。
- 验证：独立副本 `npm ci`、21 项前端单元测试、含类型检查的前端构建、8 项后端公共模块与 JWT 单元测试、完整后端编译打包均通过；核对必要源码、文档链接和排除规则，敏感信息模式扫描未发现问题。本次未执行数据库集成测试或浏览器业务回归，未操作实际数据库。

## 2026-10-11（宣传视频 v2：45 秒卡点重制）

- 重新设计为约 45 秒的版本：开场用"普通表格 → 高光快剪"制造反差，按 120 BPM 节拍网格剪辑，每个动效都推近并跟拍，深色模式切换放在 drop 上；口播改用 `zh-CN-YunjianNeural`，并改写成短句。
- 清晰度：录屏视口改为 1440×810、DPR 3，加 `--force-device-scale-factor=3` 后 screencast 输出真实的 4320×2430 帧（不加时 headless 只输出 CSS 尺寸）。`clock.js` 把页面时钟和 CSS 动画同步放慢 10 倍再抓帧，内容帧率约 70fps。用 Pillow 亚像素裁切加 Lanczos 渲染推拉镜头，最终只做一次 H.264 CRF 14 编码。
- 声音：`music.py` 用 numpy 合成 BGM 和 8 种音效（无外部采样）；口播出现时 BGM 自动压低，两遍 loudnorm 到 -14 LUFS。
- 竖版改为深色画布：上方是段落标题，中间是 4:5 主画面，并单独设计一套镜头轨迹，不再用模糊背景铺底。
- 产出：`out/v2/` 下横版 2560×1440 和 1920×1080、竖版 1440×2560 和 1080×1920，均为 60fps、47 秒；另有 SRT 字幕、横竖封面、音频预览。v1 脚本保存在 本地历史宣传素材目录，v1 成片保留不动。
- 验证：横版 1440p 码率 12.7 Mbps；响度 -14.1 LUFS，峰值 -1.2 dBFS。在同一界面区域按 1:1 截图对比 1080p 的 v1 与 v2，v2 的文字和图形明显更清晰。抽帧核对了取景、字卡和字幕的时间与位置。

## 2026-10-11（宣传视频清晰度重制）

- 录屏由 JPEG 88 抓帧改为原生 1920×1080 PNG 抓帧，取消将 1080p 图像放大成 2880×1620 的伪高分辨率步骤；素材使用 RGB 无损编码，以毫秒时间基保留动作时序、按记录时长封口并转换为 30fps，在关闭页面前等待抓帧确认完成。
- 合成的中间片段改为 RGB 无损编码，最终只做一次 H.264、CRF 14 压缩，并统一 BT.709 色彩与有限范围；竖版主体采用轻微锐化，上下背景沿用原稿的虚化效果。取景按素材实际尺寸折算，兼容原素材。
- 增加素材与成片目录参数；本次新素材写入 `_clips_hd/`，高清横竖成片、字幕和封面使用 `_hd` 后缀，保留原口播、剪辑场景与原文件；同步录制说明及项目地图。
- 验证：9 个场景完成实际页面录制；横版 1920×1080、竖版 1080×1920，均为 30fps、2158 帧、71.94 秒，两版全片解码通过；核对关键场景的文字、取景和字幕，口播音频与字幕内容和原版一致。片段按累计帧数对齐，避免逐段时长舍入产生累计偏移。

## 2026-10-11（修复：浮层内滑块首帧错位）

- 分段选择器、侧栏选中块、命令面板高亮、代码生成步骤条共用的 `slideThumb` 在祖先处于缩放过渡（弹窗 / 命令面板从触发点展开、页面进场）时量到的是缩放后的包围盒，首次打开菜单编辑弹窗时「菜单类型」滑块偏小错位，切换一次才纠正；现按祖先当前缩放比折算回布局像素。`Segmented` 另监听各选项尺寸（字体加载完成只改选项宽度时也重新对位）。
- 表单字段内的分段选择器不再被纵向 flex 拉伸成整行空槽（`.field > .segmented` 按内容定宽）；部门画布适配视口改用布局尺寸，不受页面进场缩放影响。

## 2026-10-11（图谱舞台回归珍珠玻璃）

- 撤销暗场舞台：删除 `.stage-scope` 深色令牌，改为浅 / 深主题各一套 `--graph-*` RGB 三元组；舞台底改为与外壳一致的浅底点阵 + 环境光，深色只随外观设置切换。
- 视觉隐喻替换：中心光球改为珍珠球（珠光渐变、淡虹彩、缓慢扫描的刻度环与青柠卫星点）；程序化水母神经元改为玻璃刻度表盘，刻度着色比例为真实读数（已分配角色的用户、有持有人的角色、已授权页面）；叠加发光、粒子迸发改为实色细线、18% 光环脉冲与开场细环涟漪。
- 溯源全景：条目改为围绕表盘的整齐刻度弧与放射细线，跨类授权线只在悬停聚焦时出现，名称沿放射方向排开；条目过多时不画名称。台阶、分析栏、问答坞、工具条全部回到珍珠玻璃材质。

## 2026-10-11（设计审查与第三轮重构：暗场舞台、全站中文化、数据口径修正）

- 暗场舞台（已于同日撤销，见上条）：`tokens.css` 新增 `.stage-scope`（舞台底、暗玻璃、`--glow-1~5` 发光色，并在舞台内重新声明文字 / 描边 / 面板令牌，分析栏与问答坞自动换肤）；新增 `composables/neural.ts` Canvas 绘制件（光球、程序化神经元、发光丝、脉冲、迸发、真实数据背景网络、轨道、台阶光柱、地平线）；`RelationGraph` 新增 `variant="stage"`、`network` / `networkFocus` / `networkAlpha` / `orbits`、`slab` 台阶节点与 `hover` 事件、「重播 / 暂停」，删除原随机三角网背景；可点小目标不再漂移。
- 权限溯源重做为三层下钻（全景 → 模块 → 实体），背景网络为全部用户 / 角色 / 菜单真实点位与授权线；菜单星图重做为「导航星系」（三圈刻度轨道、分支扇出、角色 → 页面 → 按钮链路，侧栏预览改为占位不覆盖）；岗位阶梯重做为「能量阶梯」（对角线铺满不裁切、光柱与地平线、脊线脉冲、成员触须，删除右侧大空面板；窄屏横向滚动）。
- 全站文案中文化：`SectionLabel` 去掉英文眉标与编号，`PageHeader` / `ListPage` 去掉 `eyebrow`；工作台日期、读数标签、用户看板（最近登录 / 从未登录）、部门读数、登录页、命令面板、矩阵、泳道等英文标签改为中文；参数面板 `light / dark / auto` 显示为浅色 / 深色 / 跟随系统（取值不变）。`.eyebrow` 改为中文小标签样式。
- 工作台：删除布局重叠且与常用入口重复的「模块网络」卡；数据权限气泡改为横向占比条（删除 `BubblePack`）；删除页头与侧块重复的规格铭牌。操作日志 / 登录日志删除与概览读数重复的页头铭牌。
- 稀疏数据：`TrendChart` 非零点 ≤ 3 时改画茎叶点并标数值；`Swimlane` 默认聚焦到有操作的时段（至少 6 小时），可切全天；`DeltaPill` 新增 `fresh`「新增」态。
- 表格：操作列吸附右侧，用户表在 1440 宽下操作列不再被挤出可视区。
- 后端口径修正：登录成功写入 `sys_user.last_login_time`（最近登录时间，此前从未写入导致看板恒显示「从未登录」）；岗位 / 角色在岗人数与工作台数据权限分布排除已删除用户；`/dashboard/summary` 的 `stats[].fresh`（上一周期为 0、无法计算环比）新增。`AuthApiTest` 补最近登录时间断言。
- 验证：前端 `npm run test:unit` 21 个用例、`npm run build`（含 vue-tsc）通过；后端 `mvn -pl scaffold-admin -am test` 46 个集成测试通过；Playwright 1440 / 390 宽、浅色 / 深色、减少动态效果截图核对三个舞台与工作台、日志、用户页；舞台页无头实测满帧、最差帧约 10ms。

## 2026-10-11（神经网络升级：全模块差异化视图与全局炫技）

> 分工说明：Phase 0–6 公共底座与前六个模块由 Claude 完成；共享视口抽取、Phase 7 岗位阶梯、Phase 8 全局炫技点及文档/验证由 Devin（SWE）完成，条目分别以【Claude】/【SWE】标注。

- 【Claude】公共底座：`composables/motion.ts` 扩展 `spring`、`createFrameLoop`、`revealCascade`、`typeOut`、`bezierAt`、`firstTimeInSession`；新增 `RelationGraph`（BFS 逐层蔓延入场、贝塞尔连线脉冲、扇形触须、悬停邻接高亮、拖拽平移与缩放）、`InsightPanel`、`AskDock` 与本地规则问答引擎 `ask.ts`；`instruments.css` 补 `.rg-*`、`.insight-*`、`.heat-*` 样式；令牌新增 `--thread`、`--thread-active`、`--pulse-halo`、`--node-bg`（浅深两套）。
- 【Claude】权限溯源：`GET /api/system/permissions/graph`（权限 `system:role:list`）返回用户、角色、菜单及用户-角色、角色-菜单两组关联；角色页新增「溯源」视图（三能力岛环绕开场、选中角色扇形展开用户与菜单、`InsightPanel` 读数下钻、底部问答坞），用户页行操作带 `?trace=user:ID` 跳转聚焦。
- 【Claude】登录热力与异常：`GET /api/monitor/login-logs/heatmap?days=`（权限 `monitor:loginlog:list`）返回 7×24 `cells` 与连续失败 `anomalies`；登录日志「02 趋势」可切热力格，对角线波纹点亮、悬停十字高亮、失败占比斜线，「03 异常」卡片点按联动明细筛选。
- 【Claude】参数设置面板：参数页默认「面板」视图（可切表格），按键名前缀分组、按值推断控件行内编辑，改动累积到底部浮条显示「原值 → 新值」一次提交，失败项保留标红。
- 【Claude】菜单星图与导航预览：菜单页新增「星图」（目录 / 菜单 / 按钮三环 radial 布局，按钮显示权限码），有角色权限时叠加角色环，孤立菜单与缺权限码按钮红描边；左侧固定导航预览实时渲染当前树，隐藏 / 停用项虚化。
- 【Claude】代码生成流水线与字典样本册：生成抽屉改三步流水线（表信息 → 字段映射贝塞尔连线 → 代码逐行级联预览）；字典页新增「样本册」视图，真实 `DictTag` 平铺，点卡片 Flip 原地展开编辑（label / tone / 排序 / 默认项金标）。
- 【SWE】共享视口：抽取 `composables/viewport.ts`（`useViewportPan`），组织画布与关系图复用同一套拖拽平移、Ctrl/⌘ + 滚轮缩放、pointer capture 与 reset 逻辑，移除两处重复实现。
- 【SWE】岗位职级阶梯：用户分页、统计与导出接口新增可选 `postId` 参数（经 `sys_user_post` 关联过滤，沿用 `@DataScope` 数据权限）；新增 `PostLadder` 组件，岗位页增加「阶梯」视图——按 `sort` 排成上升台阶，`TickRing` 显示在岗人数，点卡片右侧扇形展开在岗成员触须。
- 【SWE】命令面板「问系统」：输入 `?` 切换问答模式，展示预设问题芯片，提交后打字机 + 答案卡级联，卡片芯片可跳转对应页面；`ask.ts` 新增参数意图（开关参数、登录验证码是否开启、敏感参数值），走 `system:config:list` 权限过滤与 `configs.list` 数据；参数页支持 `?keyword=` 定位。
- 【SWE】登录神经网络背景：新增 `NeuralNet.vue`（Canvas 节点 = 能力模块，连线脉冲往返、节点缓慢呼吸），置于登录页左侧深色画布底层；登录成功时中心迸发短划并收束到对勾，页面隐藏、离屏、reduced-motion 时暂停或静态呈现。
- 【SWE】工作台开场与模块网络：本会话首次进入工作台，卡片从中心弹簧飞出依次落位；新增「模块网络」小卡（用户 / 角色 / 菜单 / 部门节点 + 关联脉冲，点节点跳转对应页面）；`/dashboard/summary` 的 `stats` 新增 `menus`（菜单项总数）与 `depts`（部门数）两项。
- 【SWE】细化动效：部门画布选中节点时根 → 当前节点路径连线高亮并沿曲线走脉冲；用户看板拖拽成功落位与取消回飞改用阻尼弹簧；操作日志详情抽屉与角色授权抽屉内容接入 `revealCascade`（约 70–90ms 级联，reduced-motion 静态呈现）。
- 【SWE】验证：前端 `npm run test:unit` 21 个用例通过，`npm run build`（含 vue-tsc）通过；后端 `mvn -pl scaffold-admin -am test` 45 个集成测试通过（含用户 `postId` 岗位过滤、权限图、登录热力与新增 summary 字段断言）。浏览器实测：登录页网络呼吸与成功迸发、工作台开场弹簧入场与模块网络节点跳转、岗位阶梯台阶与成员触须（含深色）、部门画布选中路径脉冲、命令面板 `?` 问答（预设芯片 + 三类参数意图应答 + 芯片跳转）、操作日志 / 角色抽屉级联、375px 无横向溢出、reduced-motion 静态呈现，全程无控制台错误。后端测试需本地 MySQL 与 Redis，连接信息走 `DB_*` / `REDIS_*` 环境变量。

## 2026-10-11（UI 精致化：仪器化语汇与六种版式）

- 新增仪器化语汇：等宽眉标与编号、显示级读数（逐位滚动、上标单位）、深色规格铭牌、环比胶囊、刻度尺、斜线填充、悬停名片；令牌补充等宽字体、显示字号、刻度、铭牌、5 枚只表示类别的分类色与画布环境光，样式新增 `instruments.css` 一层。
- 新增自绘图表：趋势图（切换时间档时折线形变、准星读数平滑跟随、失败序列与区间斜线）、柱状图、60 刻度成功率环、气泡占比、时间轴泳道（实时「现在」线、失败与慢操作标记）。
- 工作台改为主次布局：登录脉搏主卡（总量、环比、峰值 / 均值）+ 在线与接口侧块 + 近 7 天操作量 / 成功率环 / 数据权限气泡 + 当日操作泳道（有日志权限时）+ 最近登录与常用入口。
- 操作日志、登录日志改为横带分层（概览 → 趋势 / 泳道 → 明细）；点击泳道块按模块过滤明细。部门管理新增组织架构画布（平移缩放、连线先到节点后亮、四角浮动面板）；用户管理新增看板（按部门 / 角色 / 状态分列，按状态可拖拽启停，提供键盘「移动到…」）；角色管理新增菜单 × 角色权限矩阵（十字高亮、级联勾选、底部浮条一次提交，内置角色只读）。视图偏好按页面记在本机。
- 登录页改为全幅深色画布：实时时钟刻度、服务健康与延迟、能力面板；登录卡随指针轻倾，登录成功走「收拢 → 对勾圆环 → 进入」三拍；进入外壳的导航被取消时恢复登录按钮。
- 浮层与外壳：弹窗从触发点展开、列表行生长成详情抽屉并收回原行、批量操作改为底部深色玻璃浮条、命令面板分组为最近访问 / 页面 / 用户 / 动作并以玻璃滑块指示焦点、提示改为可悬停展开的牌堆（悬停暂停计时、倒计时细环）、主按钮涟漪、内容滚动后顶栏凝结、表格中文短字段不再逐字折行。
- 后端新增只读接口：`GET /api/monitor/oper-logs/stats`、`GET /api/monitor/oper-logs/timeline`、`GET /api/monitor/login-logs/stats`（`MonitorStatsService` / `MonitorStatsMapper`）；工作台汇总新增 `trendPrev`（上一周期登录数）与 `dailyOps`（近 7 天按日操作量）。不改表结构。
- 同步 `DESIGN.md`（七层样式、令牌、版式、能量语态表）、`PROJECT_MAP.md`、两份架构 / 接口文档与 UI 方案文档。
- 验证：后端在新建的独立校验库 `scaffold_verify` 上 `scaffold-admin` 41 个集成测试通过（含新增 `MonitorStatsApiTest` 4 个及工作台字段断言）；前端 15 个单测、类型检查与构建通过；会话回归脚本两项通过。浏览器在 1440 / 375 / 320 px 与深色下检查工作台、两个日志页、部门画布、用户看板、角色矩阵、登录页，11 个页面 320 px 无横向溢出、无 Vue 警告；实测泳道、看板拖拽停用与恢复、矩阵授权保存与还原、命令面板用户搜索跳转、行展开抽屉、提示牌堆展开。测试中的临时改动均已还原。浏览器面板处于后台时 rAF 不运行，入场长帧未能实测。

## 2026-10-10（通用后台脚手架整理与验收）

- 移除建筑、工作流模块及 Flowable 依赖，后端保留公共基础、框架、系统管理、代码生成和启动模块；数据库首次初始化收敛为 `V1__init_schema.sql`、`V2__seed_data.sql`。
- 前端采用 Vue 3、GSAP 与自有珍珠玻璃组件，移除 Element Plus 和 three；统一主题、表格密度、列表模板、查询、表单、权限按钮、字典及组织选择组件，重写登录、工作台和 10 个管理页面。
- 修复切换账号时旧路由初始化、旧菜单响应、慢退出请求及旧账号 401 覆盖新会话的问题；退出同步清除路由、权限及字典/部门缓存，未分配菜单的账号显示明确落点。
- 登录 token 增加独立标识，避免同秒重新登录生成相同 token；停用或已删除角色不再授予菜单和权限。用户页面改为按用户操作权限获取必要选项，业务字典选项与管理接口权限分开。
- 超级管理员自动获取全部菜单与权限；用户按部门筛选包含下级部门；工作台 7 天与 30 天趋势包含当天；代码预览返回全部文件，生成菜单 SQL 与当前字段及手动主键结构一致。
- 数据库、Redis 连接读取环境变量；MySQL 时区参数通过连接属性传递，避免 `+08:00` 被 URL 解码为无效值，应用连接与初始化工具统一设置数据库会话时区。
- 修复页面切换空白、减少动态效果与后台标签页关闭浮层的问题；浮层按打开顺序处理层级、焦点和 Escape，下拉层级跟随所在弹窗；长内容抽屉保持底部按钮可见，正文独立滚动。
- 新建根目录 `README.md`、`PROJECT_MAP.md`，重写 `DESIGN.md`、前端说明及三份架构/接口文档，更新 `AGENTS.md`；保留历史规划和日志，移除历史文档中的实际数据库密码，忽略本地缓存、日志和私有环境文件。
- 验证：41 个后端测试通过并完成打包，15 个前端测试通过，类型检查与构建通过。真实浏览器完成会话竞态与低权限验证、字典/菜单增改删与导出、生成器导入/配置/7 文件预览/ZIP 下载；检查 11 页在 320/375px、深色模式及减少动态效果下的显示，以及主题跟随、密度持久化、菜单搜索和嵌套浮层键盘操作。生成菜单 SQL 在集成测试中实际执行并回滚。
- 验证使用独立本地校验库。按确认删除四份旧报告/需求文档，并重建 `scaffold_system`；初始化数据移除不存在的业务表生成配置，生成器从空列表开始。代码生成输出仍是开发骨架，业务 CRUD 和页面接入需在后续项目中实现。

## 2026-06-08 (侧栏动态菜单修复)

- 修复前端侧栏动态菜单跳转：后端返回的 `/system/role`、`/system/dept` 等路径型路由不再被当作 Vue Router `name` 处理，避免点击左侧菜单时报 `No match for {"name":"/system/role"}`。
- 新增导航工具单元测试，覆盖静态菜单路由名和动态菜单路径两种跳转来源。

## 2026-06-07 (最终验收修复)

- 修复后端集成测试登录夹具：新增 `TestAuthClient`，统一按真实契约先调用 `GET /api/auth/captcha` 获取 `captchaUuid` 和验证码，再提交 `POST /api/auth/login`。
- 更新认证、系统管理、监控日志、工作流、代码生成等测试中的旧登录写法，避免验证码校验拦截导致验收测试无法覆盖真实业务接口。
- 更新 `scaffold-vue/README.md`，将“纯前端 Mock、未接后端接口”的历史说明改为当前真实接口接入状态，并补充 `VITE_API_PROXY_TARGET` 代理配置说明。
- 完成最终验收验证：`mvn test` 通过 42 个后端测试，`mvn package -DskipTests` 打包成功，`npm run test:unit` 通过 18 个前端单元测试，`npm run build` 通过；本地启动后端 `18081` 和前端 `5178`，经前端 `/api` 代理完成验证码、登录、当前用户和工作台摘要真实接口冒烟；`admin-redesign` 独立原型 `npm run build` 通过。

## 2026-06-06 (Flowable 工作流闭环)

- 接入真实 Flowable 基础运行时：`scaffold-admin` 显式声明 `flowable-spring-boot-starter-process`，dev 配置开启 Flowable schema 自动更新和 schema 更新锁，并关闭异步执行器。
- 新增 `V3__flowable_workflow.sql`：扩展 `wf_model_meta.bpmn_xml`、`deployment_id`、`process_definition_id`、`version`，新增 `wf_approval_record` 审批记录表，并补充工作流业务索引。
- 重构 `scaffold-workflow`：新增 `WorkflowStatus`、`WorkflowRequests`、`BpmnTemplateService`，模型部署改为 Flowable BPMN 部署，流程定义从部署后的 `processDefinitionId` 绑定。
- 强化工作流完整性和权限：BPMN XML 强制校验可执行 `process id` 与 `modelKey` 一致；审批接口校验当前用户必须是任务处理人、候选用户或候选组成员；撤回动作仅允许流程发起人执行。
- 兼容旧已部署模型：定义列表会自动为 `deployed=1` 但缺少 `process_definition_id` 的旧模型补部署默认 BPMN，并回填 Flowable 部署 ID、流程定义 ID 和版本号。
- 新增流程实例闭环接口：`POST /api/workflow/instances/start` 发起实例、`GET /api/workflow/instances/{processInstanceId}/trace` 查询实例轨迹；待办改为按当前用户和角色候选组读取 Flowable task，审批后完成/终止流程并写入 `wf_approval_record`。
- 流程定义和待办接口改为从 BPMN XML 解析真实节点名称；流程轨迹在完成态补充“归档”结束节点，避免轨迹停留在最后一个人工审批节点。
- 保留旧演示数据兼容：没有 Flowable 历史实例的历史 `wf_business` 待办仍可展示、审批和查看静态轨迹，避免初始化种子数据失效。
- 前端流程模型页新增 BPMN XML 编辑和默认模板生成；流程定义页新增发起流程弹窗并展示真实 BPMN 节点；待办卡片和审批抽屉进度条使用后端返回的真实 BPMN 节点；审批抽屉优先按 `processInstanceId` 加载真实实例轨迹；API 类型支持字符串任务 ID。
- 工作流前端列表改为后端 keyword 查询和分页：流程模型、流程定义、我的待办、我的已办均具备查询、重置、分页、导出；待办页新增 loading 状态，避免接口加载时误显示空任务。
- 优化工作流 UI：隐藏非发起人的“撤回”动作，提交按钮增加提交中禁用，移除侧边栏固定待办角标，修复长业务编号/流程 key/审批意见可能撑破卡片或抽屉的问题。
- 待办接口和前端类型补充 `businessKey` 业务编号，待办页本地搜索同步支持业务编号，避免后端搜索命中后被前端二次过滤隐藏。
- Vite 开发代理新增 `VITE_API_PROXY_TARGET` 环境变量覆盖能力，默认仍指向 `http://localhost:8080`，便于本地端口冲突时验证当前后端实例。
- 更新 `docs/backend-architecture.md` 和 `docs/frontend-backend-integration.md`，补充 Flowable 架构状态、接口和字段中文说明。
- 完成验证：`mvn -pl scaffold-admin -am test` 通过 42 个后端测试；`npm run test:unit` 通过 18 个前端单元测试；`npm run build` 通过；浏览器在 `http://127.0.0.1:5177` 完成流程模型 BPMN 模板、流程定义发起弹窗、待办实例轨迹和审批提交冒烟，当前页面无 console error/warn，UI 烟测数据已清理。

## 2026-06-06 (性能与健壮性修复)

- 修复前端 Vite 代理端口：`vite.config.ts` 代理目标从 `localhost:18080` 改为 `localhost:8080`，与后端实际监听端口一致。
- 修复前端 `http.ts` import 顺序：将 `authSession` 的 import 语句移到模块顶部，修正不规范的 import 位置。
- 修复后端监控日志删除/清空权限标识错误：操作日志和登录日志的 DELETE 接口从错误的 `list` 权限改为正确的 `remove` 权限，防止只有查看权限的用户删除日志。
- 移除安全配置中 `/api/test/**` 的 `permitAll` 放行规则，生产环境不再暴露测试端点；将测试安全配置移入 `TestSecurityConfig` 仅在测试时生效。
- 增强全局异常处理器：新增 `HttpMessageNotReadableException`（JSON 格式错误返回 400）、`MethodArgumentTypeMismatchException`（参数类型错误返回 400）、`IllegalArgumentException`、`HttpRequestMethodNotSupportedException`（返回 405）、`NoResourceFoundException`（返回 404）和通用 `Exception`（返回 500 并记录日志）处理，防止堆栈信息泄露。
- 修复 JWT 解析异常静默丢弃问题：添加 debug 级别日志记录失败的 token 解析。
- 修复 DashboardService 登录趋势统计的潜在 NPE：对数据库返回的 `hourValue` 和 `total` 增加 null 检查。
- 为前端流程模型部署/删除、流程定义挂起/激活、待办审批、代码生成配置保存等异步操作补充 try-catch 错误处理，防止 API 异常导致页面无反馈。
- 继续清理前端残留演示交互：工作台、流程模型、流程定义、我的已办导出改为统一 CSV 下载；工作台待办“审批”跳转到真实待办页，不再伪造审批成功。
- 新增剪贴板工具 `copyText` 并接入代码生成预览弹窗，“复制当前”改为调用浏览器 Clipboard API，失败时给出明确错误提示。
- 参数配置和字典管理的“刷新缓存”类假提示改为真实重新加载列表；登录页“忘记密码”空链接改为“联系管理员重置密码”静态提示。
- 修复待办页流程进度 Vue prop 告警：新增 `normalizeFlowStep` 将后端返回的当前节点名称映射为进度索引，`FlowSteps` 支持数字和节点名称两类输入。
- 修复部门管理删除后的前端状态残留：新增 `removeDeptFromTree` 工具并接入部门删除流程，删除成功后立即从本地部门树剔除软删节点并切回父级/根部门，避免页面继续显示已删除部门。
- 修复监控日志前端关键词过滤健壮性：新增 `includesKeyword` 工具，登录日志过滤兼容空用户名/IP，操作日志过滤兼容空字段并纳入请求参数，避免 Vue update 阶段因 `null.includes` 报错。
- 修复移动端后台外壳样式：小屏侧栏强制图标化，隐藏顶栏搜索和用户姓名，收敛工作台/待办卡片、筛选框和流程进度条的固定宽度，消除移动视口内横向溢出。
- 优化字典管理行操作可见性：字典类型编辑/删除按钮在选中行、悬停和键盘聚焦时保持可操作，避免行操作完全依赖 `display:none` 的 hover 状态。
- 修复操作日志 CSV 导出契约：导出列新增“请求参数”，确保按 `request_params` 命中的日志导出后仍能看到筛选命中字段，并新增回归测试覆盖。
- 完成验证：`npm run test:unit` 通过 16 个前端单元测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 35 个后端测试；浏览器抽样验证工作台导出/待办跳转、流程模型/流程定义/我的已办导出、代码生成预览复制和待办页流程进度无当前页面 warn/error。
- 完成浏览器路由冒烟：在 `http://localhost:5175` 逐页打开工作台、系统管理、系统监控、工作流程和代码生成共 15 个主要路由，核心标题均加载成功，当前页面无 warn/error；移动 390px 视口复验工作台和我的待办，`.app-content` 无水平滚动。
- 完成真实浏览器写操作联调：在 `http://localhost:5175` 通过页面完成参数配置新增/编辑/删除、岗位管理新增/编辑/删除、流程模型新建/配置/部署/删除；浏览器控制台无来自当前前端的 warn/error，数据库核查 `sys_config`、`wf_model_meta`、`wf_business` 无测试残留，`sys_post` 无 `deleted = 0` 的有效测试残留。
- 扩展真实浏览器全功能联调：继续覆盖用户新增/编辑/重置密码/删除、角色新增/编辑/权限保存/删除、菜单新增/编辑/显示切换/删除、部门新增/编辑/删除、字典类型和字典数据新增/编辑/删除、操作日志和登录日志筛选/详情/导出/批量删除、代码生成导入表/配置保存/预览复制/下载、流程定义流程图/挂起/激活/导出、待办审批和已办导出；所有测试数据清理后无有效 `ui_smoke` 残留。
- 完成真实 API 写操作烟测：从配置解析 `scaffold_system` 数据库连接并查表结构后，通过 8080 实例完成认证、部门、岗位、角色、用户、菜单、字典、参数、流程模型、流程定义、临时待办审批、操作日志和登录日志共 12 类写操作验证，10 项测试数据清理成功，数据库无活跃 `smoke_` 残留。

## 2026-06-06

- 补齐监控日志写能力：新增操作日志/登录日志按 ID 删除和清空接口，前端批量删除、清空改为真实后端调用，并新增 `MonitorLogWriteApiTest`。
- 补齐监控日志导出：新增 `GET /api/monitor/oper-logs/export` 和 `GET /api/monitor/login-logs/export` CSV 下载接口，前端操作日志/登录日志导出按钮改为真实文件下载，并扩展 `MonitorLogWriteApiTest` 与前端 API 映射测试。
- 补齐用户管理操作接口：新增 `GET /api/system/users/export`、`PUT /api/system/users/{id}/status` 和 `PUT /api/system/users/{id}/password`，前端用户导出、批量启停、重置密码改为真实后端调用，并扩展 `SystemWriteApiTest` 与前端 API 映射测试。
- 修复角色删除校验：角色关联的用户已被软删除时，不再阻塞角色删除，避免角色管理中已无有效用户仍提示“角色已分配用户”。
- 新增统一数据权限能力：增加 `@DataScope` 注解、`DataScopeAspect` 切面、`DataScopeCriteria` 上下文和 `DataScopeResolver` 解析接口，系统模块按当前用户角色合并 `ALL`、`DEPT`、`DEPT_AND_CHILD`、`SELF`、`CUSTOM` 数据范围，并接入用户列表和用户 CSV 导出。
- 新增统一操作日志能力：增加 `@OperLog` 注解、`OperationLogAspect` 切面、`OperationLogRecorder` 记录接口和 JDBC 写入实现，覆盖系统管理、账号改密、工作流和代码生成写接口；操作日志请求参数自动脱敏 `password`、`token`、`secret`、`authorization` 等敏感字段，并支持按请求地址和请求参数检索。
- 补齐代码生成数据库表导入：新增 `GET /api/tool/generator/importable-tables` 和 `POST /api/tool/generator/import`，通过 `information_schema` 导入 `gen_table` 与 `gen_table_column`，前端导入弹窗改为真实接口，并新增 `GeneratorImportApiTest`。
- 补齐代码生成 zip 下载：新增 `GET /api/tool/generator/tables/{id}/download`，生成 Entity、Mapper、Service、Controller、前端 API、Vue 列表页和菜单 SQL 文件压缩包；前端“生成/下载全部”改为真实下载。
- 补齐流程模型写能力：新增模型创建、编辑、删除接口，前端流程模型页新增真实新建/配置/删除弹窗交互，并新增 `WorkflowModelWriteApiTest`。
- 新增当前用户修改密码接口 `PUT /api/auth/password`，校验 `oldPassword` 后加密写入 `sys_user.password`；顶部栏修改密码弹窗改为真实接口，成功后退出重新登录，并扩展 `AuthApiTest` 与前端 API 映射测试。
- 清理顶部栏和登录页残留演示交互：搜索改为真实路由跳转，应用按钮改为快捷入口，通知读取工作台真实待办，个人中心展示当前登录用户信息，登录页文案改为测试账号提示。
- 补齐前端通用 CSV 导出工具：新增 `toCsv`/`downloadCsv`，将角色、岗位、菜单、部门、字典数据、参数配置和代码生成列表的假导出提示改为真实 CSV 文件下载，并新增 CSV 转义单元测试。
- 将 `scaffold-vue/src/data/index.ts` 从历史 Mock 数据文件收敛为类型、侧边栏导航和头像色板定义，页面数据源均走 API。
- 更新 `docs/frontend-backend-integration.md`、`docs/backend-architecture.md` 和后端开发计划状态，补充新增接口字段中文说明。
- 完成验证：`npm run test:unit` 通过 9 个前端单元测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 34 个后端测试，`mvn -pl scaffold-admin -am package -DskipTests` 打包成功，并在 `http://127.0.0.1:18080` 完成登录、工作台、工作流、生成器导入候选、生成器 zip 下载、数据权限过滤、软删用户后角色删除、改密错误校验、用户停用登录拦截、用户重置密码登录、用户 CSV 导出、操作日志自动写入与敏感字段脱敏真实接口烟测。

## 2026-06-05

- 初始化 `scaffold-system` 后端 Maven 多模块工程，新增 `scaffold-common`、`scaffold-framework`、`scaffold-system`、`scaffold-generator`、`scaffold-workflow`、`scaffold-admin` 模块。
- 新增 `ScaffoldAdminApplication`、`GET /api/health` 健康检查接口、统一响应模型 `R`、分页模型、业务异常、全局异常处理和 traceId 过滤器。
- 为后端基础能力新增 JUnit 测试，覆盖统一响应、分页参数、分页返回、健康检查、traceId 和业务异常响应，并完成 Maven 测试、打包和本地 jar 启动验证。
- 新增 早期后端开发计划（历史资料），基于现有文档和 `scaffold-vue` 前端 Demo 反推 `scaffold-system` 后端工程结构、数据库、接口、模块开发顺序和验收计划。
- 新增 `scaffold_system` MySQL 数据库初始化脚本 `V1__init_schema.sql` 和 `V2__seed_system_data.sql`，创建系统用户、角色、菜单、部门、岗位、字典、参数、日志、代码生成和工作流元数据等基础表，并写入 BCrypt 密码种子数据。
- 为 `scaffold-admin` dev 环境补充 MySQL 与 Redis 配置，完成表结构、审计字段、种子数据行数和用户数据的数据库校验。
- 实现后端认证接口：`POST /api/auth/login`、`GET /api/auth/me`、`GET /api/auth/routes`、`POST /api/auth/logout`，支持 JWT、Redis token 会话、登录/登出日志和动态菜单路由。
- 新增 `TokenStore` 并让 JWT 过滤器校验 Redis 会话状态，保证登出后的旧 token 无法继续访问受保护接口。
- 扩展认证集成测试，覆盖登录成功、登录失败、未带 token、动态路由、登出和登出后 token 失效；完成 Maven 测试、打包和真实 HTTP 验证。
- 新增系统管理只读接口：用户分页、角色分页、菜单树、部门树、岗位分页、字典类型分页、字典数据、参数配置分页，以及操作日志/登录日志分页查询。
- 新增 `SystemManagementMapper`、`SystemManagementService`、`SystemManagementController` 和 `MonitorController`，通过 SQL 聚合返回前端需要的 `deptName`、`postName`、`roleName`、`userCount` 等展示字段。
- 开启 MyBatis `call-setters-on-nulls`，保证 Map 响应中 `lastLogin` 等空值字段仍保留，稳定前端接口字段契约。
- 新增 `SystemReadApiTest` 集成测试，覆盖系统管理只读接口的分页、树结构、字典、配置和日志响应，并完成 Maven 测试、打包和真实 HTTP 抽样验证。
- 将 dev 环境 `com.scaffold` 日志级别从 `debug` 调整为 `info`，减少接口运行时 SQL 调试日志刷屏。
- 优化 `admin-redesign` 事项详情交互，将全屏模糊遮罩小弹窗改为非阻断右侧详情抽屉，保留主页面可见性并补充事项摘要、处理上下文和流转记录。
- 补全 `admin-redesign` 静态页面所有可见按钮的前端交互：全局搜索、环境切换、用户菜单、顶部导航、数据刷新、台账筛选、事项详情、通过/驳回、侧栏查看全部、审计中心与审计详情。
- 为 `admin-redesign` 新增命令搜索弹层、顶部下拉菜单、详情/列表弹窗和 Toast 反馈，保证按钮点击均有可见结果。
- 新建 `admin-redesign` 独立前端原型目录，从零创建 React + Vite 静态后台管理页面，不复用现有 `scaffold-vue` 代码。
- 按用户确认的高级发散方向实现 `Editorial Control Desk` 风格后台首页，包含顶部编辑式导航、指标条、审批与权限台账、权限风险、流程积压、生成器状态和实时审计日志。
- 为 `admin-redesign` 增加基础交互：导航选中、台账筛选、行选中联动审计事项、刷新时间更新。
- 新增 `admin-redesign/design-qa.md`，记录构建、浏览器可访问性树、视觉方向和交互验证结果。
- 按用户要求删除 `admin-redesign` 前端改造项目及其全部文件，停止对应 Vite 本地服务；保留原始静态 HTML 目录和当前项目其他文件。
- 新增 `admin-redesign` 前端项目，将 本地原型目录 的静态 HTML/CSS/JS 原型转换为 Vue 3 + Vite + TypeScript 架构。
- 将静态原型样式迁入 `admin-redesign/src/styles/prototype`，保留原型视觉语言并通过 Vue 页面复用。
- 新增 `admin-redesign/src/api`、`components`、`directives`、`layouts`、`mock`、`router`、`stores`、`types`、`utils`、`views` 等规划目录。
- 将原型布局转换为 `AdminLayout.vue`，将登录、工作台、系统管理、监控、工作流和代码生成页面按业务域拆分到 `views`。
- 新增 `BaseButton`、`BaseTable`、`SearchForm`、`FormDialog`、`StatusTag`、`PermissionButton`、`DictSelect` 等统一组件。
- 新增 `docs/admin-redesign-architecture.md`，说明静态原型资源到 Vue 规划架构的转换关系和关键字段中文含义。
- 修正 `admin-redesign` 的复刻精度：将图标体系替换为原型自定义 SVG path，按原型结构重写登录页、工作台和用户管理页，并将用户 mock 数据扩展为接近原型的 56 条。
- 为满足一比一复刻要求，新增 `admin-redesign/public/exact-prototype`，完整复制 本地原型目录 静态原型资源，并将 `admin-redesign` 默认入口切换为该原型基准渲染。
- 将 `admin-redesign` 默认入口切回真实 Vue 渲染，按原 HTML 原型的 class、布局和内容结构重做登录页、后台布局、工作台、用户、角色、菜单、部门、字典、参数、日志、工作流和代码生成等页面。
- 新增 早期产品技术规划（历史资料），规划 Spring Boot + Vue 后台管理脚手架的产品定位、技术栈、架构、核心模块、数据库原则、接口原则和迭代路线。
- 新增 `docs/prd.md`，整理后台管理脚手架的用户角色、核心流程、功能需求、页面规划、非功能需求和 MVP 验收标准。
- 新增 `scaffold-vue` 前端 Mock Demo，包含 Dashboard、RBAC + 数据权限管理、Flowable 审批中心等核心页面。
- 新增 早期前端 Demo 实现计划（历史资料），记录前端 Demo 实现计划。
- 将 `scaffold-vue` 前端 Demo 的菜单、页面标题、按钮、表格、工作流和占位模块等用户可见文案统一调整为中文。
- 补齐 `scaffold-vue` 前端 Mock 页面：用户管理、菜单管理、部门管理、字典管理、代码生成、流程模型、流程定义、审计日志、系统设置。
- 为前端 Demo 增加本地点击交互：筛选、重置、新增、编辑、状态切换、角色分配、代码预览、流程部署、审批操作、日志导出和系统设置保存。
- 新增 `scaffold-vue/src/utils/exportCsv.ts` 通用 CSV 导出工具，并为所有表格页面补充导出入口。
- 在产品技术规划和 PRD 中补充通用表格能力，明确所有列表页默认支持导出当前筛选结果。
- 新增项目级 `AGENTS.md`，将统一组件复用、统一设计语言、前后端通用能力复用定义为必须遵守的开发准则。
- 在产品技术规划中补充强制开发准则，明确新增功能优先复用或扩展通用能力。
- 补齐 `admin-redesign` 岗位管理页面、导航、路由、权限标识和 mock 数据，并按静态原型修正岗位数据、表格选择列、排序图标、分页控件与标题栏布局，修正系统管理侧边栏菜单顺序不一致的问题。
- 按静态原型重做 `admin-redesign` 菜单管理页，将扁平表格改为菜单树结构，补齐展开/收起、树形缩进、目录/菜单/按钮标签、显示开关和图标操作列，并按原型菜单树数据恢复可见行顺序。
- 启动逐页逐组件视觉审计，批量生成 Vue 与静态原型截图和 DOM 摘要；按审计结果重做部门管理、操作日志与登录日志的可见结构、文案、表头、筛选区、数据和分页控件。
- 按静态原型区分流程模型与流程定义、我的待办与我的已办页面，补齐流程定义表头、数据、状态与操作按钮，以及我的已办表格、审批结果和分页结构。
- 修正我的已办页多余筛选卡，保持与静态原型一致的单表格卡片搜索结构。
- 机械导出静态原型 `data.jsx` 为 `prototypeData.ts`，让用户、角色、部门、菜单、岗位、字典、参数和代码生成列表复用原型同源数据，避免可见内容漂移。
- 将流程模型和待办/已办页面切换为 `prototypeData` 同源流程数据，修正模型、待办卡片和代码生成等页面的可见数据差异。
- 为参数配置页补齐与原型一致的分页条和每页条数选择器。
- 为 `scaffold-system` 新增后端权限注解能力：`@RequiresPermission`、权限解析器、AOP 拦截器和 403 统一异常响应，实现后端接口级权限校验。
- 补齐系统管理写接口：用户、角色、菜单、部门、岗位、字典类型、字典数据和参数配置的新增、修改、删除接口，复用统一响应、统一分页、JWT 会话和权限注解。
- 为系统管理写接口新增集成测试 `SystemWriteApiTest` 和 `SystemCatalogWriteApiTest`，覆盖低权限用户拒绝访问、用户/岗位 CRUD、角色/部门/菜单/字典/参数配置 CRUD。
- 完成 `scaffold-system` 后端全量验证：`mvn -pl scaffold-admin -am test` 通过 18 个测试，`mvn -pl scaffold-admin -am package` 打包成功，并在 18080 端口完成真实 HTTP 登录、权限拒绝、角色 CRUD 和参数配置 CRUD 冒烟。
- 为 `scaffold-vue` 新增真实后端 API 客户端、认证 API、会话存储工具和系统管理 API 封装，新增 `npm run test:api` Node 原生测试，覆盖统一响应、Bearer token、业务错误、认证接口和系统管理端点映射。
- 将 `scaffold-vue` 登录页从本地 Mock 登录改为真实后端登录、当前用户拉取和退出登录，Vite dev server 新增 `/api` 到 `localhost:18080` 的代理。
- 将 `scaffold-vue` 用户、角色、菜单、部门、岗位、字典、参数配置页面接入真实后端读写接口，并用 Playwright 真实验证用户、角色、菜单、部门、岗位、字典、参数配置 CRUD。
- 将 `scaffold-vue` 操作日志和登录日志页面接入真实后端只读分页接口，并完成浏览器访问验证。
- 新增 `docs/frontend-backend-integration.md`，记录已接入页面、接口字段中文说明和仍使用 Mock 的后续模块。
- 新增 Dashboard 后端真实接口 `GET /api/dashboard/summary`，返回统计卡、24 小时趋势、待办和最近动态。
- 将工作流代码落入 `scaffold-workflow` 模块，新增流程模型、流程定义、待办、已办、审批和审批记录接口，并补充集成测试。
- 将代码生成器代码落入 `scaffold-generator` 模块，新增生成表、字段、预览、配置保存和生成确认接口，并补充集成测试。
- 扩展 `V2__seed_system_data.sql`，补充 `wf_model_meta`、`wf_business`、`gen_table`、`gen_table_column` 示例数据，保证新库初始化后工作流和代码生成页面有真实数据。
- 新增 `scaffold-vue/src/api/portal.ts` 和 API 映射测试，将工作台、工作流、代码生成器页面从前端 Mock 切换为真实接口。
- 新增 `docs/backend-architecture.md`，说明后端 Maven 模块、包类类型、业务边界和主要字段中文含义。
- 完成验证：`npm run test:api` 通过 8 个前端 API 测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 21 个后端测试，并完成真实后端与 Vite `/api` 代理接口联调。
