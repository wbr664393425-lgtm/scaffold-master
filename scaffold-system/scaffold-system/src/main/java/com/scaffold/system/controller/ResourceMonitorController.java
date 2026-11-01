package com.scaffold.system.controller;

import com.scaffold.common.domain.R;
import com.scaffold.framework.security.RequiresPermission;
import com.scaffold.system.service.ResourceMonitorService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/system/resource")
public class ResourceMonitorController {

    private final ResourceMonitorService service;

    public ResourceMonitorController(ResourceMonitorService service) {
        this.service = service;
    }

    /** 服务器与 Redis 实时读数：CPU、内存、JVM、磁盘挂载点与缓存状态 */
    @GetMapping
    @RequiresPermission("system:resource:list")
    public R<Map<String, Object>> snapshot() {
        return R.success(service.snapshot());
    }
}
