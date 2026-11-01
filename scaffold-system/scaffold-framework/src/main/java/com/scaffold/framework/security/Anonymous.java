package com.scaffold.framework.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 匿名访问注解：标注在 Controller 类或方法上时，该接口地址会被
 * {@link com.scaffold.framework.config.properties.PermitAllUrlProperties} 收集并加入 Spring Security 放行列表。
 * 用于移动端 APP 接口、对外开放接口与第三方异步回调等无令牌请求。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Anonymous {
}
