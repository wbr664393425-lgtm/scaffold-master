<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { revealCascade, slideThumb } from '@/composables/motion'

/* ============================================================
   选项卡：替代 el-tabs（详情抽屉、审核台的多分页表单）。
   滑块直接复用 Segmented 的同一块玻璃（motion.ts 的 slideThumb + .seg-thumb.m-pill
   落在 .m-groove 槽里），因此不另起一套分段动效；内容面板由 <TabPane> 自带。
   也支持只传 options 的纯切换用法（内容由页面自己放在下方）。
   ============================================================ */

export interface TabOption {
  label: string
  value: string
  disabled?: boolean
}

export interface TabPaneRecord {
  uid: number
  value: string
  label: string
  disabled: boolean
  badge?: string | number
}

const props = withDefaults(defineProps<{
  modelValue: string
  /** 不写 TabPane 子节点时，用 options 渲染选项条 */
  options?: TabOption[]
  /** 无障碍分组名 */
  label?: string
  /** 切换面板时内容级联显现 */
  cascade?: boolean
}>(), {
  cascade: true,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const bar = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const panes = ref<TabPaneRecord[]>([])
const visited = ref(new Set<string>())
let seed = 0

const list = computed<TabPaneRecord[]>(() => {
  if (props.options?.length) return props.options.map(o => ({ uid: -1, value: o.value, label: o.label, disabled: Boolean(o.disabled) }))
  return panes.value
})
const enabled = computed(() => list.value.filter(pane => !pane.disabled))

function isActive(value: string) {
  return props.modelValue === value
}

function shouldRender(value: string, lazy: boolean | undefined) {
  if (!lazy) return true
  return isActive(value) || visited.value.has(value)
}

provide('@@tabs', {
  register(pane: TabPaneRecord) {
    if (list.value.some(p => p.uid === pane.uid)) return
    panes.value = [...panes.value, pane].sort((a, b) => a.uid - b.uid)
  },
  update(uid: number, patch: Partial<TabPaneRecord>) {
    const index = panes.value.findIndex(p => p.uid === uid)
    if (index === -1) return
    const next = [...panes.value]
    next[index] = { ...next[index]!, ...patch }
    panes.value = next.sort((a, b) => a.uid - b.uid)
  },
  unregister(uid: number) {
    panes.value = panes.value.filter(p => p.uid !== uid)
  },
  isActive,
  shouldRender,
})

function select(value: string) {
  const pane = list.value.find(p => p.value === value)
  if (!pane || pane.disabled) return
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function activeButton() {
  const index = list.value.findIndex(p => p.value === props.modelValue)
  return bar.value?.querySelectorAll<HTMLElement>('[role="tab"]')[index] ?? null
}

function syncThumb(instant = false) {
  slideThumb(thumb.value, activeButton(), 'x', instant)
}

function onKeydown(event: KeyboardEvent) {
  const items = enabled.value
  if (!items.length) return
  const index = Math.max(0, items.findIndex(p => p.value === props.modelValue))
  let target = -1
  if (event.key === 'ArrowRight') target = (index + 1) % items.length
  else if (event.key === 'ArrowLeft') target = (index - 1 + items.length) % items.length
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = items.length - 1
  if (target < 0) return
  event.preventDefault()
  select(items[target].value)
  nextTick(() => activeButton()?.focus())
}

let observer: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => syncThumb(true))
  observer = new ResizeObserver(() => syncThumb(true))
  if (bar.value) {
    observer.observe(bar.value)
    bar.value.querySelectorAll('[role="tab"]').forEach(node => observer!.observe(node))
  }
})

onBeforeUnmount(() => observer?.disconnect())

watch(() => props.modelValue, (value) => {
  visited.value = new Set([...visited.value, value])
  nextTick(() => {
    syncThumb()
    if (props.cascade && body.value) revealCascade(body.value, ':scope > .tab-pane', 0.06)
  })
}, { immediate: true })

watch(() => list.value.map(p => `${p.value}:${p.label}`).join('|'), () => nextTick(() => syncThumb()))

defineExpose({ select })
</script>

<template>
  <section class="tabs">
    <div
      ref="bar"
      class="tabs-bar m-groove"
      role="tablist"
      :aria-label="label"
      @keydown="onKeydown"
    >
      <span ref="thumb" class="seg-thumb m-pill" aria-hidden="true" />
      <button
        v-for="pane in list"
        :id="`tab-${pane.value}`"
        :key="pane.value"
        type="button"
        role="tab"
        :aria-selected="isActive(pane.value)"
        :aria-controls="`panel-${pane.value}`"
        :aria-disabled="pane.disabled || undefined"
        :tabindex="isActive(pane.value) ? 0 : -1"
        :class="['tab-item', isActive(pane.value) && 'is-active', pane.disabled && 'is-disabled']"
        :disabled="pane.disabled"
        @click="select(pane.value)"
      >
        {{ pane.label }}
        <span v-if="pane.badge !== undefined" class="tab-badge tnum">{{ pane.badge }}</span>
      </button>
    </div>

    <div ref="body" class="tabs-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.tabs { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
/* 与 .segmented 同款：槽 + 一块滑过去的玻璃，按钮只改颜色 */
.tabs-bar {
  position: relative;
  display: inline-flex;
  align-self: flex-start;
  max-width: 100%;
  padding: 3px;
  border-radius: var(--r-sm);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs-bar::-webkit-scrollbar { display: none; }
.tabs-bar:has(.tab-item:focus-visible) { outline: 2px solid var(--focus); outline-offset: 3px; }
.tabs-bar .seg-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  z-index: 0;
  pointer-events: none;
  border-radius: var(--r-xs);
}
.tab-item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 13px;
  border-radius: var(--r-xs);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-soft);
  white-space: nowrap;
  outline: none;
  transition: color .2s ease;
}
.tab-item:hover:not(:disabled) { color: var(--ink); }
.tab-item.is-active { color: var(--ink); }
.tab-item.is-disabled { color: var(--ink-faint); cursor: not-allowed; }
.tab-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: var(--ink-muted);
  background: rgba(var(--shade), .08);
}
.tab-item.is-active .tab-badge { color: var(--blue); background: var(--blue-soft); }
.tabs-body { min-width: 0; }
</style>
