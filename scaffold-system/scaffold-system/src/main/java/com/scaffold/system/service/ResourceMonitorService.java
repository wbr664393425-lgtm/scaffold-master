package com.scaffold.system.service;

import com.sun.management.OperatingSystemMXBean;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.File;
import java.lang.management.ClassLoadingMXBean;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.lang.management.RuntimeMXBean;
import java.lang.management.ThreadMXBean;
import java.net.InetAddress;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * 服务器、缓存与数据库资源实时读数
 *
 * <p>只读采集，不落库、不做历史留存：JVM 侧走 JMX，Redis 侧走连接自身的 INFO / PING，
 * 数据库侧读 Hikari 池水位与 MySQL 全局状态；某一侧采不到时该段读数降级为 -1，不影响其余采集。
 */
@Service
public class ResourceMonitorService {

    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 一次 SHOW GLOBAL STATUS 取回的连接与负载指标 */
    private static final String STATUS_NAMES = "('Uptime','Threads_connected','Threads_running','Max_used_connections',"
            + "'Slow_queries','Questions','Connections','Aborted_connects')";
    private static final String VARIABLE_NAMES = "('version','max_connections','innodb_buffer_pool_size','wait_timeout')";

    private final RedisConnectionFactory redisConnectionFactory;
    private final DataSource dataSource;

    public ResourceMonitorService(RedisConnectionFactory redisConnectionFactory, DataSource dataSource) {
        this.redisConnectionFactory = redisConnectionFactory;
        this.dataSource = dataSource;
    }

    public Map<String, Object> snapshot() {
        OperatingSystemMXBean os = (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("collectedAt", TIME_FORMAT.format(Instant.now().atZone(ZoneId.systemDefault())));
        data.put("server", server(os));
        data.put("cpu", cpu(os));
        data.put("memory", memory(os));
        data.put("jvm", jvm(os));
        data.put("disks", disks());
        data.put("redis", redis());
        data.put("database", database());
        return data;
    }

    /* ── 服务器与 JVM 基本信息 ─────────────────────────────────────────────── */

    private Map<String, Object> server(OperatingSystemMXBean os) {
        RuntimeMXBean runtime = ManagementFactory.getRuntimeMXBean();
        long started = runtime.getStartTime();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("hostname", host(true));
        data.put("hostIp", host(false));
        data.put("osName", System.getProperty("os.name", "—"));
        data.put("osVersion", System.getProperty("os.version", "—"));
        data.put("osArch", System.getProperty("os.arch", "—"));
        data.put("cpuCores", os.getAvailableProcessors());
        data.put("javaVersion", System.getProperty("java.version", "—"));
        data.put("javaVendor", System.getProperty("java.vm.vendor", "—"));
        data.put("pid", runtime.getPid());
        data.put("zone", ZoneId.systemDefault().getId());
        data.put("startTime", TIME_FORMAT.format(Instant.ofEpochMilli(started).atZone(ZoneId.systemDefault())));
        data.put("uptimeSeconds", runtime.getUptime() / 1000);
        return data;
    }

    private String host(boolean name) {
        try {
            InetAddress local = InetAddress.getLocalHost();
            return name ? local.getHostName() : local.getHostAddress();
        } catch (Exception error) {
            return "—";
        }
    }

    /* ── CPU ──────────────────────────────────────────────────────────────── */

    private long lastProcessCpuTime = -1;
    private long lastSampleNano;

    /**
     * 本进程 CPU 占用。macOS 上 {@code getCpuLoad()} 恒为 -1，因此按两次采样之间的
     * 进程 CPU 时间差 / 墙钟差折算（对全部核归一），首次请求没有基准点时回落到 JMX 瞬时值。
     */
    private synchronized double processCpuUsage(OperatingSystemMXBean os, int cores) {
        long cpuTime = os.getProcessCpuTime();
        long wall = System.nanoTime();
        double usage = -1;
        if (cpuTime >= 0 && lastProcessCpuTime >= 0 && wall > lastSampleNano) {
            double cpuMillis = (cpuTime - lastProcessCpuTime) / 1_000_000d;
            double capacityMillis = (wall - lastSampleNano) / 1_000_000d * Math.max(1, cores);
            usage = capacityMillis > 0 ? Math.min(100, cpuMillis / capacityMillis * 100) : -1;
        }
        if (cpuTime >= 0) {
            lastProcessCpuTime = cpuTime;
            lastSampleNano = wall;
        }
        // 首次请求没有基准点，回落到 JMX 瞬时值（Linux 上可用，macOS 仍为 -1）
        if (usage < 0) usage = percent(os.getCpuLoad());
        return Double.isNaN(usage) ? -1 : round(usage, 1);
    }

    private Map<String, Object> cpu(OperatingSystemMXBean os) {
        int cores = os.getAvailableProcessors();
        double load = os.getSystemLoadAverage();
        Double average = load < 0 ? null : round(load, 2);
        double system = systemCpuUsage(os);
        boolean estimated = false;
        // macOS 上 getSystemCpuLoad() 恒为 -1，退而用 1 分钟负载 / 核数折算，页面会标注口径
        if (system < 0 && average != null) {
            system = round(Math.min(100, average / Math.max(1, cores) * 100), 1);
            estimated = true;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("cores", cores);
        data.put("processUsage", processCpuUsage(os, cores));
        data.put("systemUsage", system);
        data.put("systemUsageEstimated", estimated);
        data.put("loadAverage", average);
        return data;
    }

    /**
     * 整机 CPU 占用。JDK 17 把 {@code getSystemCpuLoad()} 标了废弃，但它仍是唯一能拿到
     * 整机瞬时占用的入口（{@code getCpuLoad()} 只统计本进程），容器内取不到时返回 -1 由页面显示「—」。
     */
    @SuppressWarnings("deprecation")
    private double systemCpuUsage(OperatingSystemMXBean os) {
        return percent(os.getSystemCpuLoad());
    }

    /* ── 内存 ─────────────────────────────────────────────────────────────── */

    private Map<String, Object> memory(OperatingSystemMXBean os) {
        long total = os.getTotalMemorySize();
        long free = os.getFreeMemorySize();
        long used = total - free;
        long swapTotal = os.getTotalSwapSpaceSize();
        long swapFree = os.getFreeSwapSpaceSize();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("total", total);
        data.put("used", used);
        data.put("free", free);
        data.put("usage", total > 0 ? percent((double) used / total) : -1);
        data.put("swapTotal", swapTotal);
        data.put("swapUsed", swapTotal - swapFree);
        data.put("swapUsage", swapTotal > 0 ? percent((double) (swapTotal - swapFree) / swapTotal) : -1);
        return data;
    }

    /* ── JVM 与进程 ───────────────────────────────────────────────────────── */

    private Map<String, Object> jvm(OperatingSystemMXBean os) {
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        MemoryUsage heap = memoryBean.getHeapMemoryUsage();
        MemoryUsage nonHeap = memoryBean.getNonHeapMemoryUsage();
        ThreadMXBean threads = ManagementFactory.getThreadMXBean();
        ClassLoadingMXBean classes = ManagementFactory.getClassLoadingMXBean();

        List<Map<String, Object>> collectors = new ArrayList<>();
        long gcCount = 0;
        long gcTime = 0;
        for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", bean.getName());
            row.put("count", Math.max(0, bean.getCollectionCount()));
            row.put("timeMs", Math.max(0, bean.getCollectionTime()));
            collectors.add(row);
            gcCount += Math.max(0, bean.getCollectionCount());
            gcTime += Math.max(0, bean.getCollectionTime());
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("heapUsed", heap.getUsed());
        data.put("heapCommitted", heap.getCommitted());
        data.put("heapMax", heap.getMax());
        data.put("heapUsage", heap.getMax() > 0 ? percent((double) heap.getUsed() / heap.getMax()) : -1);
        data.put("nonHeapUsed", nonHeap.getUsed());
        data.put("gcCount", gcCount);
        data.put("gcTimeMs", gcTime);
        data.put("collectors", collectors);
        data.put("threads", threads.getThreadCount());
        data.put("peakThreads", threads.getPeakThreadCount());
        data.put("daemonThreads", threads.getDaemonThreadCount());
        data.put("loadedClasses", classes.getLoadedClassCount());
        data.put("totalLoadedClasses", classes.getTotalLoadedClassCount());
        data.put("unloadedClasses", classes.getUnloadedClassCount());
        // 文件描述符只在类 Unix 主机（含容器）上可得，Windows 下留空
        if (os instanceof com.sun.management.UnixOperatingSystemMXBean unix) {
            data.put("openFileDescriptors", unix.getOpenFileDescriptorCount());
            data.put("maxFileDescriptors", unix.getMaxFileDescriptorCount());
        }
        return data;
    }

    /* ── 磁盘 ─────────────────────────────────────────────────────────────── */

    private List<Map<String, Object>> disks() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (File root : File.listRoots()) {
            long total = root.getTotalSpace();
            if (total <= 0) continue;
            long free = root.getUsableSpace();
            long used = total - free;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("path", root.getPath());
            row.put("total", total);
            row.put("used", used);
            row.put("free", free);
            row.put("usage", percent((double) used / total));
            list.add(row);
        }
        return list;
    }

    /* ── Redis ───────────────────────────────────────────────────────────── */

    private Map<String, Object> redis() {
        Map<String, Object> data = new LinkedHashMap<>();
        try (RedisConnection connection = redisConnectionFactory.getConnection()) {
            long begin = System.nanoTime();
            connection.ping();
            data.put("pingMicros", Math.max(0, (System.nanoTime() - begin) / 1000));
            Properties info = connection.serverCommands().info();
            data.put("online", true);
            data.put("error", null);
            data.put("version", info.getProperty("redis_version", "—"));
            data.put("mode", info.getProperty("redis_mode", "standalone"));
            data.put("os", info.getProperty("os", "—"));
            data.put("uptimeSeconds", longOf(info, "uptime_in_seconds"));
            data.put("usedMemory", longOf(info, "used_memory"));
            data.put("usedMemoryHuman", info.getProperty("used_memory_human", "—"));
            data.put("usedMemoryPeak", longOf(info, "used_memory_peak"));
            data.put("maxMemory", longOf(info, "maxmemory"));
            data.put("maxMemoryPolicy", info.getProperty("maxmemory_policy", "noeviction"));
            data.put("fragmentRatio", doubleOf(info, "mem_fragmentation_ratio"));
            data.put("connectedClients", longOf(info, "connected_clients"));
            data.put("blockedClients", longOf(info, "blocked_clients"));
            data.put("opsPerSec", longOf(info, "instantaneous_ops_per_sec"));
            data.put("totalCommands", longOf(info, "total_commands_processed"));
            data.put("rejectedConnections", longOf(info, "rejected_connections"));
            data.put("expiredKeys", longOf(info, "expired_keys"));
            data.put("evictedKeys", longOf(info, "evicted_keys"));
            data.put("hitRate", hitRate(info));
            List<Map<String, Object>> space = keyspace(connection);
            data.put("keyspace", space);
            // INFO 的 dbsize 只反映当前连接的库，取不到时按 keyspace 各库键数合计
            long declared = longOf(info, "dbsize");
            data.put("dbSize", declared > 0 ? declared : space.stream().mapToLong(row -> (Long) row.get("keys")).sum());
        } catch (Exception error) {
            data.put("online", false);
            data.put("error", messageOf(error));
            data.put("pingMicros", null);
        }
        return data;
    }

    /** keyspace 段不在默认 INFO 输出里，单独取一次 */
    private List<Map<String, Object>> keyspace(RedisConnection connection) {
        List<Map<String, Object>> list = new ArrayList<>();
        try {
            Properties space = connection.serverCommands().info("keyspace");
            space.stringPropertyNames().stream().filter(key -> key.startsWith("db")).sorted().forEach(key -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("db", key);
                row.put("raw", space.getProperty(key, ""));
                row.put("keys", fieldOf(space.getProperty(key, ""), "keys"));
                row.put("expires", fieldOf(space.getProperty(key, ""), "expires"));
                list.add(row);
            });
        } catch (Exception ignored) {
            // 拿不到 keyspace 不影响其余读数，返回已收集部分
        }
        return list;
    }

    private long fieldOf(String value, String field) {
        for (String part : value.split(",")) {
            String[] pair = part.split("=", 2);
            if (pair.length == 2 && pair[0].trim().equals(field)) {
                try {
                    return Long.parseLong(pair[1].trim());
                } catch (NumberFormatException ignored) {
                    return 0;
                }
            }
        }
        return 0;
    }

    private double hitRate(Properties info) {
        long hits = longOf(info, "keyspace_hits");
        long misses = longOf(info, "keyspace_misses");
        long total = hits + misses;
        return total > 0 ? percent((double) hits / total) : -1;
    }

    private long longOf(Properties info, String key) {
        try {
            return Long.parseLong(info.getProperty(key, "0").trim());
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private double doubleOf(Properties info, String key) {
        try {
            return round(Double.parseDouble(info.getProperty(key, "0").trim()), 2);
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private String messageOf(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) {
            return error.getClass().getSimpleName();
        }
        return message.length() > 180 ? message.substring(0, 180) : message;
    }

    /* ── 数据库 ───────────────────────────────────────────────────────────── */

    /**
     * 连接池与 MySQL 分开采集：池水位来自 Hikari 自身的 MXBean（不需要额外权限），
     * 全局状态要 PROCESS 权限，生产用受限账号时会单独降级而不影响池读数。
     */
    private Map<String, Object> database() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("pool", pool());
        data.put("mysql", mysql());
        return data;
    }

    private Map<String, Object> pool() {
        Map<String, Object> data = new LinkedHashMap<>();
        try {
            HikariDataSource hikari = dataSource.unwrap(HikariDataSource.class);
            HikariPoolMXBean bean = hikari.getHikariPoolMXBean();
            int max = hikari.getMaximumPoolSize();
            data.put("online", bean != null);
            data.put("error", null);
            data.put("name", hikari.getPoolName());
            data.put("max", max);
            data.put("minIdle", hikari.getMinimumIdle());
            data.put("timeoutMs", hikari.getConnectionTimeout());
            if (bean != null) {
                data.put("active", bean.getActiveConnections());
                data.put("idle", bean.getIdleConnections());
                data.put("total", bean.getTotalConnections());
                data.put("awaiting", bean.getThreadsAwaitingConnection());
                data.put("usage", max > 0 ? round(Math.min(100, bean.getActiveConnections() * 100.0 / max), 1) : -1);
            }
        } catch (Exception error) {
            data.put("online", false);
            data.put("error", messageOf(error));
        }
        return data;
    }

    private Map<String, Object> mysql() {
        Map<String, Object> data = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            Properties status = collect(statement, "SHOW GLOBAL STATUS WHERE Variable_name IN " + STATUS_NAMES);
            Properties variables = collect(statement, "SHOW GLOBAL VARIABLES WHERE Variable_name IN " + VARIABLE_NAMES);
            long uptime = longOf(status, "Uptime");
            long questions = longOf(status, "Questions");

            data.put("online", true);
            data.put("error", null);
            data.put("version", variables.getProperty("version", "—"));
            data.put("uptimeSeconds", uptime);
            data.put("threadsConnected", longOf(status, "Threads_connected"));
            data.put("threadsRunning", longOf(status, "Threads_running"));
            data.put("maxConnections", longOf(variables, "max_connections"));
            data.put("peakConnections", longOf(status, "Max_used_connections"));
            data.put("connectionUsage", connectionUsage(status, variables));
            data.put("slowQueries", longOf(status, "Slow_queries"));
            data.put("questions", questions);
            data.put("qps", uptime > 0 ? round((double) questions / uptime, 1) : -1);
            data.put("connections", longOf(status, "Connections"));
            data.put("abortedConnects", longOf(status, "Aborted_connects"));
            data.put("bufferPoolBytes", longOf(variables, "innodb_buffer_pool_size"));
            data.put("waitTimeout", longOf(variables, "wait_timeout"));
            data.put("schema", schema(statement));
        } catch (Exception error) {
            data.put("online", false);
            data.put("error", messageOf(error));
        }
        return data;
    }

    /** 当前连接占 max_connections 的百分比；受限账号取不到变量时返回 -1 */
    private double connectionUsage(Properties status, Properties variables) {
        long max = longOf(variables, "max_connections");
        return max > 0 ? round(Math.min(100, longOf(status, "Threads_connected") * 100.0 / max), 1) : -1;
    }

    /** 当前库的表数量与占用；InnoDB 的行数是估算值，页面按「约」展示 */
    private Map<String, Object> schema(Statement statement) throws SQLException {
        Map<String, Object> data = new LinkedHashMap<>();
        String sql = """
                SELECT DATABASE() AS name,
                       COUNT(*) AS tables_count,
                       COALESCE(SUM(data_length), 0) AS data_bytes,
                       COALESCE(SUM(index_length), 0) AS index_bytes,
                       COALESCE(SUM(table_rows), 0) AS row_estimate
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                """;
        try (ResultSet rs = statement.executeQuery(sql)) {
            if (rs.next()) {
                data.put("name", rs.getString("name"));
                data.put("tables", rs.getLong("tables_count"));
                data.put("dataBytes", rs.getLong("data_bytes"));
                data.put("indexBytes", rs.getLong("index_bytes"));
                data.put("rowEstimate", rs.getLong("row_estimate"));
            }
        }
        return data;
    }

    private Properties collect(Statement statement, String sql) throws SQLException {
        Properties properties = new Properties();
        try (ResultSet rs = statement.executeQuery(sql)) {
            while (rs.next()) {
                properties.setProperty(rs.getString(1), rs.getString(2));
            }
        }
        return properties;
    }

    /* ── 通用换算 ─────────────────────────────────────────────────────────── */

    /** 0~1 的占用率转成百分数；采不到（负值或 NaN）统一返回 -1，由页面显示「—」 */
    private double percent(double ratio) {
        if (Double.isNaN(ratio) || ratio < 0) return -1;
        return round(Math.min(1, ratio) * 100, 1);
    }

    private double round(double value, int scale) {
        double factor = Math.pow(10, scale);
        return Math.round(value * factor) / factor;
    }
}
