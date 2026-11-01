<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { Button, DataTable, Descriptions, DescriptionsItem, Metric, PageHeader, Panel, SectionLabel, Switch, Tag, type Column } from '@/components/ui'
import TrendChart from '@/components/charts/TrendChart.vue'
import { systemApi, type ResourceSnapshot } from '@/api'
import { toastError } from '@/composables/toast'

/* ============================================================
   资源监测：当前服务所在主机与 Redis 的实时读数。
   只读、不落库；近 5 分钟曲线由本页采样累积，离开页面即丢弃。
   ============================================================ */
type UsageRow = { key: string; label: string; value: number; sub: string; tone: string; toneText: string; hot: boolean }

const REFRESH_MS = 5000
const MAX_SAMPLES = 60

const snapshot = ref<ResourceSnapshot | null>(null)
const loading = ref(false)
const auto = ref(true)
const samples = ref<Array<{ at: string; cpu: number; memory: number }>>([])
let timer = 0

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
function bytes(value: number | undefined | null) {
  if (!value || value <= 0) return value === 0 ? '0 B' : '—'
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const size = value / Math.pow(1024, exponent)
  return `${size >= 100 || exponent === 0 ? Math.round(size) : size.toFixed(1)} ${UNITS[exponent]}`
}

/** 后端采不到时回传 -1，页面一律显示「—」而不是 0% */
function usage(value: number | undefined) {
  if (value === undefined || value < 0) return '—'
  return `${value.toFixed(1)}%`
}
const LEVEL: Record<string, { tone: string; text: string }> = {
  ok: { tone: 'ok', text: '正常' },
  info: { tone: 'info', text: '偏高' },
  danger: { tone: 'danger', text: '紧张' },
  neutral: { tone: 'neutral', text: '未知' },
}

/**
 * 利用率读数：≥90% 紧张、75–90% 偏高、其余正常；命中率这类「越高越好」的传 goodHigh 反向判定。
 * hot 驱动进度条转红，与标签同一档位，避免条是蓝的、标签写「偏高」各说一套。
 */
function meter(key: string, label: string, value: number, sub: string, goodHigh = false): UsageRow {
  const score = value < 0 ? -1 : goodHigh ? 100 - value : value
  const rank = score < 0 ? 'neutral' : score >= 90 ? 'danger' : score >= 75 ? 'info' : 'ok'
  return { key, label, value, sub, tone: LEVEL[rank].tone, toneText: LEVEL[rank].text, hot: score >= 90 }
}
function duration(seconds: number | undefined) {
  if (!seconds || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days} 天 ${hours} 小时` : hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
}

const meters = computed<UsageRow[]>(() => {
  const s = snapshot.value
  if (!s) return []
  const worst = s.disks.reduce((max, disk) => Math.max(max, disk.usage), -1)
  const worstPath = s.disks.reduce((best, disk) => (disk.usage > (best?.usage ?? -1) ? disk : best), s.disks[0])
  const load = s.cpu.loadAverage === null ? `${s.cpu.cores} 核` : `${s.cpu.cores} 核 · 1 分钟负载 ${s.cpu.loadAverage}${s.cpu.systemUsageEstimated ? '（按负载折算）' : ''}`
  return [
    meter('cpu', '整机 CPU', s.cpu.systemUsage, load),
    meter('process', '本进程 CPU', s.cpu.processUsage, `PID ${s.server.pid} · ${s.server.hostname}`),
    meter('memory', '物理内存', s.memory.usage, `${bytes(s.memory.used)} / ${bytes(s.memory.total)}`),
    meter('heap', 'JVM 堆', s.jvm.heapUsage, `${bytes(s.jvm.heapUsed)} / ${bytes(s.jvm.heapMax)}`),
    meter('swap', '交换分区', s.memory.swapUsage, s.memory.swapTotal > 0 ? `${bytes(s.memory.swapUsed)} / ${bytes(s.memory.swapTotal)}` : '主机未启用'),
    meter('disk', '磁盘占用最高', worst, worstPath ? `${worstPath.path} · 剩余 ${bytes(worstPath.free)}` : '未取到挂载点'),
  ]
})

const cpuSeries = computed(() => samples.value.map(item => Math.max(0, item.cpu)))
const memorySeries = computed(() => samples.value.map(item => Math.max(0, item.memory)))
const seriesLabels = computed(() => samples.value.map(item => item.at))

const redis = computed(() => snapshot.value?.redis ?? null)
const redisMeter = computed(() => {
  const info = redis.value
  if (!info?.online || !info.usedMemory) return -1
  // 未设 maxmemory 时按主机物理内存折算，否则按配置上限
  const cap = info.maxMemory && info.maxMemory > 0 ? info.maxMemory : snapshot.value?.memory.total ?? 0
  return cap > 0 ? Math.min(100, Math.round((info.usedMemory / cap) * 1000) / 10) : -1
})
const redisMeters = computed<UsageRow[]>(() => {
  const info = redis.value
  if (!info?.online) return []
  const capped = (info.maxMemory ?? 0) > 0
  return [
    meter(
      'memory',
      capped ? '内存使用率' : '内存占主机',
      redisMeter.value,
      capped
        ? `${info.usedMemoryHuman} · 上限 ${bytes(info.maxMemory)} · 策略 ${info.maxMemoryPolicy}`
        : `${info.usedMemoryHuman} · 未设置 maxmemory（${info.maxMemoryPolicy}），按主机内存折算`,
    ),
    meter(
      'hit',
      '键命中率',
      info.hitRate ?? -1,
      `淘汰 ${info.evictedKeys ?? 0} 键 · 过期 ${info.expiredKeys ?? 0} 键 · 碎片率 ${info.fragmentRatio ?? '—'}`,
      true,
    ),
  ]
})
const keyspaceText = computed(() => {
  const list = redis.value?.keyspace ?? []
  if (!list.length) return '当前无键'
  return list.map(row => `${row.db} ${row.keys} 键（过期 ${row.expires}）`).join(' · ')
})

const pool = computed(() => snapshot.value?.database?.pool ?? null)
const mysql = computed(() => snapshot.value?.database?.mysql ?? null)
const dbOnline = computed(() => Boolean(pool.value?.online) || Boolean(mysql.value?.online))
const dbMeters = computed<UsageRow[]>(() => {
  if (!dbOnline.value) return []
  const rows = [
    meter(
      'pool',
      '连接池占用',
      pool.value?.usage ?? -1,
      pool.value?.online
        ? `活跃 ${pool.value.active} / 上限 ${pool.value.max} · 空闲 ${pool.value.idle} · 排队 ${pool.value.awaiting} 线程`
        : '连接池读数不可用',
    ),
    meter(
      'sessions',
      '会话占用',
      mysql.value?.connectionUsage ?? -1,
      mysql.value?.online
        ? `连接 ${mysql.value.threadsConnected} / 上限 ${mysql.value.maxConnections} · 运行中 ${mysql.value.threadsRunning}`
        : '需要 MySQL PROCESS 权限',
    ),
  ]
  return rows
})
const schemaText = computed(() => {
  const s = mysql.value?.schema
  if (!s?.name) return '—'
  return `${s.name} · ${s.tables} 张表 · 数据 ${bytes(s.dataBytes)} + 索引 ${bytes(s.indexBytes)} · 约 ${s.rowEstimate.toLocaleString('zh-CN')} 行`
})

const diskColumns: Column[] = [
  { key: 'path', title: '挂载点', minWidth: 160 },
  { key: 'total', title: '总量', width: 120 },
  { key: 'used', title: '已用', width: 120 },
  { key: 'free', title: '可用', width: 120 },
  { key: 'usage', title: '使用率', minWidth: 220 },
]
const collectorColumns: Column[] = [
  { key: 'name', title: '收集器', minWidth: 200 },
  { key: 'count', title: '回收次数', width: 120 },
  { key: 'timeMs', title: '累计耗时', width: 140 },
]

function pushSample(s: ResourceSnapshot) {
  samples.value = [
    ...samples.value.slice(-(MAX_SAMPLES - 1)),
    { at: s.collectedAt.slice(11), cpu: Math.max(0, s.cpu.systemUsage), memory: Math.max(0, s.memory.usage) },
  ]
}

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    const data = await systemApi.resource.snapshot()
    snapshot.value = data
    pushSample(data)
  } catch (error) {
    toastError(error, '资源读数获取失败')
  } finally {
    loading.value = false
  }
}

function startTimer() {
  stopTimer()
  timer = window.setInterval(() => {
    if (auto.value && document.visibilityState === 'visible') void load()
  }, REFRESH_MS)
}
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = 0
  }
}

watch(auto, enabled => { if (enabled && !timer) startTimer() })
onMounted(() => {
  void load()
  startTimer()
})
onBeforeUnmount(stopTimer)
</script>

<template>
  <div class="page resource-page">
    <PageHeader title="资源监测" desc="当前服务所在主机、Redis 与 MySQL 的实时读数，每 5 秒采样一次；只读展示，不做历史留存。">
      <span class="collected tnum">采集于 {{ snapshot?.collectedAt ?? '—' }}</span>
      <span class="auto-toggle">
        <Switch v-model="auto" label="自动刷新" />
      </span>
      <Button variant="text" icon="refresh" :loading="loading && !snapshot" @click="load">刷新</Button>
    </PageHeader>

    <div class="stack">
      <Panel title="资源利用率" :meta="snapshot ? `${snapshot.server.cpuCores} 核 · ${bytes(snapshot.memory.total)} 内存 · ${snapshot.server.osName}` : '采集中'" padded>
        <ul class="meter-grid">
          <li v-for="item in meters" :key="item.key">
            <div class="meter-head">
              <span class="meter-label">{{ item.label }}</span>
              <span class="meter-value tnum">{{ usage(item.value) }}</span>
              <Tag :tone="item.tone">{{ item.toneText }}</Tag>
            </div>
            <span class="meter-track"><i :style="{ width: `${Math.min(100, Math.max(0, item.value))}%` }" :class="{ 'is-high': item.hot }" /></span>
            <span class="meter-sub">{{ item.sub }}</span>
          </li>
        </ul>
        <div class="usage-chart">
          <SectionLabel title="近 5 分钟采样" />
          <TrendChart
            v-if="samples.length > 1"
            :values="cpuSeries"
            :secondary="memorySeries"
            :labels="seriesLabels"
            primary-label="整机 CPU"
            secondary-label="内存"
            unit="%"
            :max="100"
            :height="220"
          />
          <p v-else class="hint">曲线需要至少两次采样，页面停留几秒后即可看到整机 CPU 与内存走势。</p>
        </div>
      </Panel>

      <div class="panel-pair">
        <Panel title="服务器与运行时" padded>
          <Descriptions :column="2">
            <DescriptionsItem label="主机名">{{ snapshot?.server.hostname ?? '—' }}</DescriptionsItem>
            <DescriptionsItem label="内网地址"><span class="tnum">{{ snapshot?.server.hostIp ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="操作系统">{{ snapshot?.server.osName }} {{ snapshot?.server.osVersion }}</DescriptionsItem>
            <DescriptionsItem label="架构"><span class="tnum">{{ snapshot?.server.osArch }}</span></DescriptionsItem>
            <DescriptionsItem label="JDK">{{ snapshot?.server.javaVersion ?? '—' }}</DescriptionsItem>
            <DescriptionsItem label="虚拟机厂商">{{ snapshot?.server.javaVendor ?? '—' }}</DescriptionsItem>
            <DescriptionsItem label="启动时间"><span class="tnum">{{ snapshot?.server.startTime ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="已运行">{{ duration(snapshot?.server.uptimeSeconds) }}<span class="sub tnum"> · {{ snapshot?.server.zone }}</span></DescriptionsItem>
          </Descriptions>
        </Panel>

        <Panel title="JVM 与进程" padded>
          <div class="jvm-readouts">
            <Metric :value="snapshot ? Math.max(0, snapshot.jvm.heapUsage) : null" unit="%" size="l" :decimals="1" label="堆使用率" />
            <Metric :value="snapshot?.jvm.threads ?? null" size="l" label="活动线程" />
            <Metric :value="snapshot?.jvm.gcCount ?? null" unit="次" size="l" label="GC 累计" />
            <Metric :value="snapshot?.jvm.openFileDescriptors ?? null" size="l" :label="snapshot?.jvm.maxFileDescriptors ? '文件描述符' : '文件描述符（不支持）'" />
          </div>
          <Descriptions :column="2" size="sm">
            <DescriptionsItem label="非堆已用"><span class="tnum">{{ bytes(snapshot?.jvm.nonHeapUsed) }}</span></DescriptionsItem>
            <DescriptionsItem label="堆已提交"><span class="tnum">{{ bytes(snapshot?.jvm.heapCommitted) }}</span></DescriptionsItem>
            <DescriptionsItem label="GC 累计耗时"><span class="tnum">{{ (snapshot?.jvm.gcTimeMs ?? 0).toLocaleString('zh-CN') }} ms</span></DescriptionsItem>
            <DescriptionsItem label="类加载"><span class="tnum">{{ snapshot?.jvm.loadedClasses ?? '—' }} / 累计 {{ snapshot?.jvm.totalLoadedClasses ?? '—' }} / 已卸载 {{ snapshot?.jvm.unloadedClasses ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem v-if="snapshot?.jvm.maxFileDescriptors" label="文件描述符上限"><span class="tnum">{{ snapshot.jvm.openFileDescriptors }} / {{ snapshot.jvm.maxFileDescriptors }}</span></DescriptionsItem>
            <DescriptionsItem label="峰值线程"><span class="tnum">{{ snapshot?.jvm.peakThreads ?? '—' }}（守护 {{ snapshot?.jvm.daemonThreads ?? '—' }}）</span></DescriptionsItem>
          </Descriptions>
        </Panel>
      </div>

      <Panel title="Redis 缓存" :meta="redis?.online ? `${redis.version} · ${redis.mode}` : '连接状态'" padded>
        <template #tools>
          <Tag :tone="redis?.online ? 'ok' : 'danger'" dot>{{ redis?.online ? '已连接' : '未连接' }}</Tag>
        </template>
        <div v-if="redis && !redis.online" class="dep-down">
          <span class="dep-down-ico"><Icon name="alert" :size="18" /></span>
          <div>
            <div class="dep-down-title">缓存连接不可用</div>
            <div class="hint break">{{ redis.error }}</div>
          </div>
        </div>
        <div v-else class="dep-body">
          <ul class="meter-grid">
            <li v-for="item in redisMeters" :key="item.key">
              <div class="meter-head">
                <span class="meter-label">{{ item.label }}</span>
                <span class="meter-value tnum">{{ usage(item.value) }}</span>
                <Tag :tone="item.tone">{{ item.toneText }}</Tag>
              </div>
              <span class="meter-track"><i :style="{ width: `${Math.min(100, Math.max(0, item.value))}%` }" :class="{ 'is-high': item.hot }" /></span>
              <span class="meter-sub">{{ item.sub }}</span>
            </li>
          </ul>
          <Descriptions :column="3" size="sm">
            <DescriptionsItem label="PING 往返"><span class="tnum">{{ redis?.pingMicros ?? '—' }} µs</span></DescriptionsItem>
            <DescriptionsItem label="已连接客户端"><span class="tnum">{{ redis?.connectedClients ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="阻塞客户端"><span class="tnum">{{ redis?.blockedClients ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="当前操作"><span class="tnum">{{ redis?.opsPerSec ?? '—' }} ops/s</span></DescriptionsItem>
            <DescriptionsItem label="累计命令"><span class="tnum">{{ (redis?.totalCommands ?? 0).toLocaleString('zh-CN') }}</span></DescriptionsItem>
            <DescriptionsItem label="键总数"><span class="tnum">{{ redis?.dbSize ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="内存碎片率"><span class="tnum">{{ redis?.fragmentRatio ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="峰值内存"><span class="tnum">{{ bytes(redis?.usedMemoryPeak) }}</span></DescriptionsItem>
            <DescriptionsItem label="淘汰策略">{{ redis?.maxMemoryPolicy ?? '—' }}</DescriptionsItem>
            <DescriptionsItem label="运行时长">{{ duration(redis?.uptimeSeconds) }}</DescriptionsItem>
            <DescriptionsItem label="拒绝连接"><span class="tnum">{{ redis?.rejectedConnections ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="服务端系统">{{ redis?.os ?? '—' }}</DescriptionsItem>
            <DescriptionsItem label="键空间" :span="3">{{ keyspaceText }}</DescriptionsItem>
          </Descriptions>
        </div>
      </Panel>

      <Panel title="数据库" :meta="mysql?.online ? `MySQL ${mysql.version} · ${pool?.name ?? '连接池'}` : '连接池与全局状态'" padded>
        <template #tools>
          <Tag :tone="dbOnline ? (mysql?.online ? 'ok' : 'info') : 'danger'" dot>
            {{ dbOnline ? (mysql?.online ? '已连接' : '部分可用') : '不可用' }}
          </Tag>
        </template>
        <div v-if="!dbOnline" class="dep-down">
          <span class="dep-down-ico"><Icon name="alert" :size="18" /></span>
          <div>
            <div class="dep-down-title">数据库读数不可用</div>
            <div class="hint break">{{ pool?.error || mysql?.error || '未取到连接池与全局状态' }}</div>
          </div>
        </div>
        <div v-else class="dep-body">
          <ul class="meter-grid">
            <li v-for="item in dbMeters" :key="item.key">
              <div class="meter-head">
                <span class="meter-label">{{ item.label }}</span>
                <span class="meter-value tnum">{{ usage(item.value) }}</span>
                <Tag :tone="item.tone">{{ item.toneText }}</Tag>
              </div>
              <span class="meter-track"><i :style="{ width: `${Math.min(100, Math.max(0, item.value))}%` }" :class="{ 'is-high': item.hot }" /></span>
              <span class="meter-sub">{{ item.sub }}</span>
            </li>
          </ul>
          <Descriptions :column="3" size="sm">
            <DescriptionsItem label="池上限 / 最小空闲"><span class="tnum">{{ pool?.max ?? '—' }} / {{ pool?.minIdle ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="池内连接"><span class="tnum">{{ pool?.total ?? '—' }}（活跃 {{ pool?.active ?? '—' }} · 空闲 {{ pool?.idle ?? '—' }}）</span></DescriptionsItem>
            <DescriptionsItem label="取连接超时"><span class="tnum">{{ pool?.timeoutMs ? `${pool.timeoutMs.toLocaleString('zh-CN')} ms` : '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="历史峰值连接"><span class="tnum">{{ mysql?.peakConnections ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="累计请求 / QPS"><span class="tnum">{{ (mysql?.questions ?? 0).toLocaleString('zh-CN') }} / {{ mysql?.qps ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="慢查询累计"><span class="tnum">{{ mysql?.slowQueries ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="累计连接 / 中断"><span class="tnum">{{ mysql?.connections ?? '—' }} / {{ mysql?.abortedConnects ?? '—' }}</span></DescriptionsItem>
            <DescriptionsItem label="InnoDB 缓冲池"><span class="tnum">{{ bytes(mysql?.bufferPoolBytes) }}</span></DescriptionsItem>
            <DescriptionsItem label="数据库运行时长">{{ duration(mysql?.uptimeSeconds) }}</DescriptionsItem>
            <DescriptionsItem label="当前库" :span="3">{{ schemaText }}</DescriptionsItem>
          </Descriptions>
          <p v-if="!mysql?.online" class="hint">连接池水位可用，但全局状态取不到（需要 PROCESS 权限）：{{ mysql?.error }}</p>
        </div>
      </Panel>

      <Panel title="磁盘挂载点">
        <DataTable :columns="diskColumns" :data="snapshot?.disks ?? []" row-key="path" :loading="loading && !snapshot" :min-width="720" empty-text="未取到挂载点信息">
          <template #cell-path="{ row }"><span class="mono">{{ row.path }}</span></template>
          <template #cell-total="{ row }"><span class="tnum soft">{{ bytes(row.total) }}</span></template>
          <template #cell-used="{ row }"><span class="tnum soft">{{ bytes(row.used) }}</span></template>
          <template #cell-free="{ row }"><span class="tnum soft">{{ bytes(row.free) }}</span></template>
          <template #cell-usage="{ row }">
            <span class="disk-usage">
              <span class="meter-track"><i :style="{ width: `${row.usage}%` }" :class="{ 'is-high': row.usage >= 90 }" /></span>
              <b class="tnum">{{ usage(row.usage) }}</b>
            </span>
          </template>
        </DataTable>
      </Panel>

      <Panel title="GC 收集器">
        <DataTable :columns="collectorColumns" :data="snapshot?.jvm.collectors ?? []" row-key="name" :loading="loading && !snapshot" :min-width="480" empty-text="未取到回收器信息">
          <template #cell-count="{ row }"><span class="tnum soft">{{ row.count }}</span></template>
          <template #cell-timeMs="{ row }"><span class="tnum soft">{{ row.timeMs.toLocaleString('zh-CN') }} ms</span></template>
        </DataTable>
      </Panel>

      <p class="hint">本页读数来自运行中的服务自身（JMX、Redis INFO 与 MySQL 全局状态）：容器内 CPU / 物理内存看到的是宿主机，磁盘、JVM 与连接池是容器和进程自己的；macOS 下「空闲内存」不含文件缓存，物理内存使用率会明显偏高，整机 CPU 在取不到瞬时值时按 1 分钟负载折算。</p>
    </div>
  </div>
</template>

<style scoped>
.collected {
  font-size: 12px;
  color: var(--ink-faint);
  white-space: nowrap;
}
.auto-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.panel-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
}
.meter-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px 28px;
}
.meter-grid li {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.meter-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.meter-label {
  font-size: 12.5px;
  color: var(--ink-muted);
}
.meter-value {
  margin-left: auto;
  font-size: 13px;
  font-weight: 680;
}
.meter-track {
  position: relative;
  display: block;
  height: 8px;
  border-radius: 999px;
  background: var(--hover-bg);
  overflow: hidden;
}
.meter-track i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--blue);
  transition: width .5s var(--ease-premium);
}
/* 只分两档：接近打满才转红，避免把「偏高」画成青柠（本底座里青柠 = 正常与能力） */
.meter-track i.is-high { background: var(--red); }
.meter-sub {
  font-size: 11.5px;
  color: var(--ink-faint);
}
.usage-chart {
  min-width: 0;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.jvm-readouts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.sub {
  color: var(--ink-faint);
  font-size: 12px;
}
.dep-body {
  display: grid;
  gap: 18px;
}
.dep-down {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.dep-down-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  color: var(--red-text);
  background: var(--red-soft);
  flex: none;
}
.dep-down-title {
  font-size: 13.5px;
  font-weight: 650;
  margin-bottom: 2px;
}
.disk-usage {
  display: flex;
  align-items: center;
  gap: 10px;
}
.disk-usage .meter-track {
  flex: 1;
  min-width: 90px;
}
.disk-usage b {
  font-size: 12.5px;
  min-width: 56px;
  text-align: right;
}
.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.soft {
  color: var(--ink-soft);
}
@media (max-width: 620px) {
  .meter-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .meter-track i { transition: none; }
}
</style>
