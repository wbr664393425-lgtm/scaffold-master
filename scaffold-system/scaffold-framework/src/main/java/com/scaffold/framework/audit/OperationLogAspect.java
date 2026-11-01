package com.scaffold.framework.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.scaffold.framework.web.IpUtils;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;

@Aspect
@Component
public class OperationLogAspect {

    private static final int MAX_PARAMS_LENGTH = 4_000;
    private static final int MAX_ERROR_LENGTH = 4_000;

    private final OperationLogRecorder recorder;
    private final ObjectMapper objectMapper;

    public OperationLogAspect(OperationLogRecorder recorder, ObjectMapper objectMapper) {
        this.recorder = recorder;
        this.objectMapper = objectMapper;
    }

    @Around("@annotation(operLog)")
    public Object record(ProceedingJoinPoint joinPoint, OperLog operLog) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = joinPoint.proceed();
            record(joinPoint, operLog, start, 1, null);
            return result;
        } catch (Throwable error) {
            record(joinPoint, operLog, start, 0, error);
            throw error;
        }
    }

    private void record(ProceedingJoinPoint joinPoint, OperLog operLog, long start, int result, Throwable error) {
        HttpServletRequest request = currentRequest();
        recorder.record(new OperationLogEntry(
                operLog.module(),
                operLog.action(),
                request == null ? null : request.getMethod(),
                request == null ? null : request.getRequestURI(),
                truncate(params(joinPoint.getArgs()), MAX_PARAMS_LENGTH),
                currentUsername(),
                request == null ? null : IpUtils.getIpAddr(request),
                System.currentTimeMillis() - start,
                result,
                truncate(error == null ? null : error.getMessage(), MAX_ERROR_LENGTH)
        ));
    }

    private HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }

    private String params(Object[] args) {
        try {
            JsonNode root = objectMapper.valueToTree(filterSerializableArgs(args));
            maskSensitiveFields(root);
            return objectMapper.writeValueAsString(root);
        } catch (JsonProcessingException | IllegalArgumentException | IllegalStateException error) {
            // 参数不可序列化时只丢日志内容，不能让审计写入把业务请求带崩
            return "[]";
        }
    }

    /**
     * 剔除无法（或不应）序列化的容器对象：导出/下载接口持有 HttpServletResponse，
     * 序列化会触发 getOutputStream() already called；上传接口持有 MultipartFile；
     * ServletRequest、绑定结果与视图模型同理必须排除。
     */
    private Object[] filterSerializableArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return new Object[0];
        }
        List<Object> kept = new ArrayList<>(args.length);
        for (Object arg : args) {
            if (isExcluded(arg)) {
                continue;
            }
            kept.add(arg);
        }
        return kept.toArray();
    }

    private boolean isExcluded(Object arg) {
        return arg instanceof ServletRequest
                || arg instanceof ServletResponse
                || arg instanceof MultipartFile
                || arg instanceof BindingResult
                || arg instanceof Model;
    }

    private void maskSensitiveFields(JsonNode node) {
        if (node instanceof ObjectNode objectNode) {
            objectNode.fieldNames().forEachRemaining(field -> {
                JsonNode child = objectNode.get(field);
                if (isSensitive(field)) {
                    objectNode.put(field, "******");
                } else {
                    maskSensitiveFields(child);
                }
            });
            return;
        }
        if (node instanceof ArrayNode arrayNode) {
            arrayNode.forEach(this::maskSensitiveFields);
        }
    }

    private boolean isSensitive(String field) {
        String lower = field.toLowerCase();
        return lower.contains("password")
                || lower.contains("token")
                || lower.contains("secret")
                || lower.contains("authorization");
    }

    private String currentUsername() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication == null ? null : String.valueOf(authentication.getPrincipal());
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }
}
