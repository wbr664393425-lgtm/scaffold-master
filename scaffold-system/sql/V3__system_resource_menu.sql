-- ==============================================================================================
-- V3__system_resource_menu.sql — 系统管理 · 资源监测菜单与角色授权
--
-- 目的：在「系统管理」目录下新增「资源监测」页面（`views/system/resource/index.vue`），
--       展示当前服务所在主机的 CPU / 内存 / 交换 / 磁盘、JVM 堆与 GC、进程线程与文件描述符，
--       以及 Redis 的内存、客户端、OPS、命中率与键空间，另有 HikariCP 池水位与 MySQL 连接读数。
-- 接口：`GET /api/system/resource`，权限码 `system:resource:list`（只读，无写操作按钮）。
-- ID 段：V2 的 100–107 已占用系统管理页面号，本文件使用未占用的 108（按钮段 1081 预留未用）。
-- 授权：只补超级管理员(1)。V2 只按当时的菜单全集给角色 1 授权，其余种子角色默认不授予任何
--       菜单、由管理员在「角色管理」中分配（见 README），这里若顺手给角色 2 画一条，
--       会让系统管理员变成「只有资源监测一个页面」的孤立状态，与本库种子策略冲突。
-- 幂等：INSERT IGNORE，可重复执行。
-- ==============================================================================================

INSERT IGNORE INTO sys_menu (id, parent_id, menu_name, menu_type, icon, path, component, permission, sort, visible, status, create_by, update_by)
VALUES
    (108, 100, '资源监测', 'menu', 'activity', '/system/resource', 'system/resource/index', 'system:resource:list', 8, 1, 1, 'system', 'system');

INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (1, 108);
