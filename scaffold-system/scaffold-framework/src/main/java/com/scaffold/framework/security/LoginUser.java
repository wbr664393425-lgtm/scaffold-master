package com.scaffold.framework.security;

/**
 * 当前登录用户凭据：由 {@link JwtAuthenticationFilter} 从 JWT 声明中解析后挂到 Authentication.details 上。
 * principal 仍保持用户名字符串，避免影响既有基于 principal 的权限/数据范围/操作日志逻辑。
 *
 * @param userId 用户ID（sys_user.id），用于业务归属与审计
 * @param username 用户账号，用于权限解析与审计
 */
public record LoginUser(Long userId, String username) {

    public Long getUserId() {
        return userId;
    }

    public String getUsername() {
        return username;
    }
}
