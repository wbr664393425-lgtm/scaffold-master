package com.scaffold.framework.security;

import com.scaffold.common.exception.BusinessException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * 当前登录用户访问工具类。业务代码通过本类获取操作人信息，禁止在 Service 中再次解析请求头。
 */
public final class SecurityUtils {

    /** 取不到登录主体时返回给前端的 HTTP 状态码（未认证） */
    private static final int UNAUTHORIZED = 401;

    private SecurityUtils() {
    }

    /**
     * 获取当前登录用户ID
     */
    public static Long getUserId() {
        try {
            return getLoginUser().userId();
        } catch (Exception ex) {
            throw new BusinessException(UNAUTHORIZED, "获取用户ID异常");
        }
    }

    /**
     * 获取当前登录用户账号
     */
    public static String getUsername() {
        try {
            return getLoginUser().username();
        } catch (Exception ex) {
            throw new BusinessException(UNAUTHORIZED, "获取用户账户异常");
        }
    }

    /**
     * 获取当前登录用户凭据
     */
    public static LoginUser getLoginUser() {
        Authentication authentication = getAuthentication();
        if (authentication == null || !(authentication.getDetails() instanceof LoginUser loginUser) || loginUser.username() == null) {
            throw new BusinessException(UNAUTHORIZED, "获取用户信息异常");
        }
        return loginUser;
    }

    /**
     * 是否已认证（未认证时返回 false 而非抛异常，便于审计等弱依赖场景）
     */
    public static boolean isAuthenticated() {
        Authentication authentication = getAuthentication();
        return authentication != null && authentication.getDetails() instanceof LoginUser loginUser && loginUser.username() != null;
    }

    public static Authentication getAuthentication() {
        return SecurityContextHolder.getContext().getAuthentication();
    }
}
