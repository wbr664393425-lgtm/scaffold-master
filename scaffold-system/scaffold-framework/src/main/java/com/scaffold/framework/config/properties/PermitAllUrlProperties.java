package com.scaffold.framework.config.properties;

import com.scaffold.framework.security.Anonymous;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 扫描所有 Controller 上标注 {@link Anonymous} 的接口地址，形成匿名放行 URL 列表。
 * 路径变量 {xxx} 统一替换为 *，与 Spring Security 的 AntPath/PathPattern 匹配规则保持一致。
 */
@Configuration
public class PermitAllUrlProperties implements InitializingBean, ApplicationContextAware {

    private static final Pattern PATTERN = Pattern.compile("\\{(.*?)}");

    private ApplicationContext applicationContext;

    private final List<String> urls = new ArrayList<>();

    @Override
    public void afterPropertiesSet() {
        RequestMappingHandlerMapping mapping = applicationContext.getBeanProvider(RequestMappingHandlerMapping.class).getIfUnique();
        if (mapping == null) {
            return;
        }
        Map<RequestMappingInfo, HandlerMethod> handlerMethods = mapping.getHandlerMethods();
        handlerMethods.forEach((info, handlerMethod) -> {
            Set<String> patterns = patternValues(info);
            if (patterns.isEmpty()) {
                return;
            }
            Anonymous method = AnnotationUtils.findAnnotation(handlerMethod.getMethod(), Anonymous.class);
            Anonymous controller = AnnotationUtils.findAnnotation(handlerMethod.getBeanType(), Anonymous.class);
            if (method != null || controller != null) {
                patterns.forEach(url -> urls.add(PATTERN.matcher(url).replaceAll("*")));
            }
        });
    }

    @Override
    public void setApplicationContext(ApplicationContext context) throws BeansException {
        this.applicationContext = context;
    }

    public List<String> getUrls() {
        return urls;
    }

    /**
     * Spring Boot 3 默认使用 PathPatternParser，getPatternsCondition() 可能为空，
     * 这里统一取 RequestMappingInfo 的字符串模式集合，兼容两种匹配策略。
     */
    private Set<String> patternValues(RequestMappingInfo info) {
        Set<String> values = info.getPatternValues();
        return values == null ? Set.of() : new LinkedHashSet<>(values);
    }
}
