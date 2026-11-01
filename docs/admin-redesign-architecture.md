# 前端组件与页面架构

当前前端是接入真实后端的 Vue 后台底座，使用珍珠玻璃设计语言；历史静态原型已移除。

## 分层与复用

| 层 | 入口 | 中文职责 |
| --- | --- | --- |
| 请求 | `src/api/http.ts`、`session.ts`、各业务 API | 统一响应、token、文件下载与 401 |
| 会话与路由 | `src/composables/auth.ts`、`src/router/index.ts` | 用户、权限、服务端菜单、页面注册与退出 |
| 通用状态 | `src/composables/list.ts`、`dict.ts`、`dept.ts`、`dateValue.ts`、`popover.ts`、`upload.ts` | 查询、分页、导出、引用选项与缓存；日期值与显示分离、浮层定位与键盘关闭、上传传输与状态机 |
| 基础控件 | `src/components/ui` | 统一按钮、输入、数字、多行文本、下拉、树形下拉、日期与区间、标签页、表格、标签、上传与图片预览、只读描述列表、浮层 |
| 业务组件 | `src/components/business` | 列表、表单、行操作（平铺 + 「更多」下拉）、权限、字典、部门和用户选择 |
| 外壳 | `src/components/layout` | 导航、搜索、移动侧栏、主题和账号操作 |
| 页面 | `src/views` | 业务字段、动作、校验与差异展示 |
| 视觉与交互 | `src/styles`、`appearance.ts`、`motion.ts`、`focus.ts` | 六层样式、主题、密度、动效及浮层焦点 |

## 页面结构

列表使用 `ListPage` + `useListPage`，树列表使用 `useTreeListPage`；统一查询、重置、加载、分页、导出与勾选。页面通过列定义及插槽补业务展示，表单通过 `FormDialog` 复用公共结构，行操作通过 `RowActions` + `RowMenuItem` 承载——常用动作平铺、低频与危险动作收进 teleport 到 body 的「更多」菜单，表格横向滚动与 `overflow` 裁剪都盖不住它；`PermissionButton` 未显式传 `icon` 时按文案取默认图标。非列表页沿用 `PageHeader` → `.stack` → 多个 `Panel` 的骨架（资源监测页即如此）。

`sys_menu.component` 的解析在 `composables/auth.ts`：先查 `COMPONENT_ALIAS` 显式别名（仅限文件名与 `component` 值不同名的底座页面），其余按 `views/<component>.vue` 用 `import.meta.glob` 自动解析，新增页面不必改这个文件；解析不到的条目直接跳过，不注册空白路由。

字典下拉调用业务选项接口，用户页面调用用户引用选项接口；不得为了显示筛选项而要求角色、岗位、字典或参数的管理权限。部门组件可接收已有数据，避免重复请求。

## 会话生命周期

登录前撤销上一次会话状态；退出先捕获旧 token 发送请求，同时清空本地会话和动态路由。旧请求通过 `sessionVersion` 拦截写回，路由初始化会被取消；晚到的旧 token 401 不清理新账号。

无菜单账号进入明确的无菜单页面；未匹配或未授权地址进入未匹配页面；后端始终独立校验权限。外壳不再循环导入路由入口。

## 浮层与动效

公共焦点管理根据浮层打开顺序控制层级，最上层处理 Tab 和 Escape，关闭后恢复触发焦点；下拉层级跟随所在浮层。GSAP 动效集中在 `motion.ts`，后台标签页及减少动态效果直接完成终态。

路由切换的 `<Transition mode="out-in">` 必须作用在元素根上，因此 `AppShell.vue` 在 `<component :is>` 外垫了一层 `.route-frame`：`ListPage` 与弹窗是兄弟节点的片段页面否则不会触发 leave / enter 钩子，`isLeaving` 永真会让新页面渲染成注释占位、`.reveal` 停在 `opacity: 0`（肉眼是白屏）。`motion.ts` 的 `pageRootOf` 把补间与 `is-entrance-ready` 落回容器内的 `.page`，`pageEnter` / `pageLeave` 用幂等 `finish()` 加兜底定时器保证 `done()` 一定放行，`ListPage` 另在 `onMounted` 自显现一次兜住钩子不触发的情况。

各模块、路径、接口与权限见根目录 `PROJECT_MAP.md`，视觉参数以 `DESIGN.md` 和实际样式令牌为准。
