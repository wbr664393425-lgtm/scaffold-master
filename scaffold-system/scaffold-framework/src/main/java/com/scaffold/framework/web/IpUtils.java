package com.scaffold.framework.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 客户端 IP 解析：按代理头优先级取值，未命中时回退到连接远端地址。
 * 与 RuoYi IpUtils 的取值顺序保持一致，供限流、操作日志等通用能力复用。
 */
public final class IpUtils {

    private static final String UNKNOWN = "unknown";

    private static final String[] IP_HEADERS = {
            "x-forwarded-for",
            "Proxy-Client-IP",
            "WL-Proxy-Client-IP",
            "X-Real-IP",
            "HTTP_CLIENT_IP",
            "HTTP_X_FORWARDED_FOR"
    };

    private IpUtils() {
    }

    /**
     * 获取当前请求的客户端 IP，非 Web 线程返回 unknown
     */
    public static String getIpAddr() {
        return getIpAddr(getRequest());
    }

    public static String getIpAddr(HttpServletRequest request) {
        if (request == null) {
            return UNKNOWN;
        }
        String ip = null;
        for (String header : IP_HEADERS) {
            ip = request.getHeader(header);
            if (isValid(ip)) {
                break;
            }
        }
        if (!isValid(ip)) {
            ip = request.getRemoteAddr();
        }
        if ("0:0:0:0:0:0:0:1".equals(ip)) {
            ip = "127.0.0.1";
        }
        // X-Forwarded-For 可能是多级代理列表，取第一个非 unknown 的地址
        if (ip != null && ip.contains(",")) {
            for (String segment : ip.split(",")) {
                if (isValid(segment)) {
                    ip = segment.trim();
                    break;
                }
            }
        }
        return ip == null ? UNKNOWN : ip.trim();
    }

    public static HttpServletRequest getRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }

    private static boolean isValid(String ip) {
        return ip != null && !ip.isEmpty() && !UNKNOWN.equalsIgnoreCase(ip);
    }
}
