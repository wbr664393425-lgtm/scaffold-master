-- ==============================================================================================
-- V3__system_resource_menu.sql — 系统管理 · 资源监测菜单与角色授权
--
-- 目的：在「系统管理」目录下新增「资源监测」页面（`views/system/resource/index.vue`），
--       展示当前服务所在主机的 CPU / 内存 / 交换 / 磁盘、JVM 堆与 GC、进程线程与文件描述符，
--       以及 Redis 的内存、客户端、OPS、命中率与键空间，另有 HikariCP 池水位与 MySQL 连接读数。
-- 接口：`GET /api/system/resource`，权限码 `system:resource:list`（只读，无写操作按钮）。
-- ID 段：V2 的 100–107 已占用系统管理页面号，本文件使用未占用的 108（按钮段 1081 预留未用）。
-- 授权：与其余系统管理页面一致，仅超级管理员(1) 与 系统管理员(2) 可见；
--       V2 按当时的菜单全集给角色 1 授权，新增菜单需要在独立版本文件里补授。
-- 幂等：INSERT IGNORE，可重复执行。
-- ==============================================================================================

INSERT IGNORE INTO sys_menu (id, parent_id, menu_name, menu_type, icon, path, component, permission, sort, visible, status, create_by, update_by)
VALUES
    (108, 100, '资源监测', 'menu', 'activity', '/system/resource', 'system/resource/index', 'system:resource:list', 8, 1, 1, 'system', 'system');

INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (1, 108), (2, 108);
