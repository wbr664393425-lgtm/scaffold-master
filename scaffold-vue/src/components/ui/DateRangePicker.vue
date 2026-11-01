<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { overlayEnter, overlayLeave, revealRows } from '@/composables/motion'
import { usePopover } from '@/composables/popover'
import {
  WEEK_HEAD, addMonths, compareDay, dayValue, monthGrid, monthLabel, parseDate, presetRange,
  shiftDay, toCanonical, todayParts, withinLimit,
  type DateParts, type GridDay, type RangeKind,
} from '@/composables/dateValue'

/* ============================================================
   日期范围选择器：替代 el-date-picker type="daterange" / "datetimerange"。
   取值始终是 [string, string] | null（规范串，不用 Date 对象）：
     daterange      → ['2026-03-01', '2026-03-08']
     datetimerange  → ['2026-03-01 00:00:00', '2026-03-08 23:59:59']
   datetimerange 首次选日默认带 00:00:00 / 23:59:59（与 RuoYi 的 default-time 一致），可手改。
   同时 change 事件抛出 { beginTime, endTime }，迁移页直接摊进查询参数。
   ============================================================ */

export interface DateRangePickerProps {
  modelValue?: [string, string] | null
  type?: RangeKind
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  /** 可选下界（YYYY-MM-DD，按天生效） */
  min?: string
  /** 可选上界（YYYY-MM-DD，按天生效） */
  max?: string
  invalid?: boolean
}

export interface RangeChange {
  beginTime: string | null
  endTime: string | null
}

const props = withDefaults(defineProps<DateRangePickerProps>(), {
  modelValue: null,
  type: 'daterange',
  placeholder: '请选择日期范围',
  clearable: true,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: [string, string] | null): void
  (e: 'change', value: RangeChange): void
}>()

const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pop = usePopover({ trigger, panel, minWidth: 560 })
const panelId = `dr-${Math.random().toString(36).slice(2, 8)}`

const isDateTime = computed(() => props.type === 'datetimerange')
const weekHead = WEEK_HEAD

/** 正在拼装的区间（日粒度；datetime 时 h/m/s 带在同一个对象上） */
const start = ref<DateParts | null>(null)
const end = ref<DateParts | null>(null)
const hover = ref<DateParts | null>(null)
/** 左面板的年月（右面板恒为 +1 月） */
const view = ref<DateParts>(todayParts())

const cursor = computed(() => hover.value ?? end.value ?? start.value ?? view.value)

function hydrate() {
  const pair = props.modelValue
  start.value = pair?.[0] ? parseDate(pair[0]) : null
  end.value = pair?.[1] ? parseDate(pair[1]) : null
  view.value = start.value ? { ...view.value, ...pickYm(start.value) } : todayParts()
  hover.value = null
}

const pickYm = (parts: DateParts) => ({ year: parts.year, month: parts.month })

const shown = computed(() => {
  const pair = props.modelValue
  if (!pair?.[0] && !pair?.[1]) return null
  const low = pair?.[0] ? String(pair[0]).slice(0, isDateTime.value ? 16 : 10) : ''
  const high = pair?.[1] ? String(pair[1]).slice(0, isDateTime.value ? 16 : 10) : ''
  return [low, high]
})

const leftCells = computed(() => monthGrid(view.value.year, view.value.month))
const rightCells = computed(() => {
  const next = addMonths(view.value, 1)
  return monthGrid(next.year, next.month)
})

const leftTitle = computed(() => `${view.value.year} 年 ${monthLabel(view.value.month)}`)
const rightTitle = computed(() => {
  const next = addMonths(view.value, 1)
  return `${next.year} 年 ${monthLabel(next.month)}`
})

const rangeEdge = computed((): [DateParts, DateParts] | null => {
  if (!start.value) return null
  if (end.value) return compareDay(start.value, end.value) <= 0 ? [start.value, end.value] : [end.value, start.value]
  if (hover.value && compareDay(hover.value, start.value) < 0) return [hover.value, start.value]
  return hover.value ? [start.value, hover.value] : null
})

function isEdge(parts: DateParts, which: 'start' | 'end') {
  const edge = rangeEdge.value
  if (!edge) return false
  return dayValue(edge[which === 'start' ? 0 : 1]) === dayValue(parts)
}

function isInRange(parts: DateParts) {
  const edge = rangeEdge.value
  if (!edge) return false
  const value = dayValue(parts)
  return value > dayValue(edge[0]) && value < dayValue(edge[1])
}

function selectable(parts: DateParts) {
  if (props.disabled) return false
  return withinLimit(parts, props.min, props.max)
}

/** 面板格子状态类名（端点实心蓝 / 区间浅蓝面 / 悬停预览用青柠） */
function cellClass(cell: GridDay) {
  const parts = cell.parts
  return [
    !cell.inCurrentMonth && 'is-muted',
    (isEdge(parts, 'start') || isEdge(parts, 'end')) && 'is-edge',
    isInRange(parts) && 'is-inside',
    Boolean(hover.value) && isInRange(parts) && !end.value && 'is-preview',
    !isEdge(parts, 'start') && !isEdge(parts, 'end') && dayValue(cursor.value) === dayValue(parts) && 'is-cursor',
    isNow(parts) && 'is-today',
    !selectable(parts) && 'is-disabled',
  ]
}

function isNow(parts: DateParts) {
  return dayValue(parts) === dayValue(todayParts())
}

function snapshot(): [string, string] | null {
  if (!start.value || !end.value) return null
  const low = compareDay(start.value, end.value) <= 0 ? [start.value, end.value] : [end.value, start.value]
  return [toCanonical(low[0], props.type), toCanonical(low[1], props.type)]
}

function emitValue() {
  const value = snapshot()
  emit('update:modelValue', value)
  emit('change', { beginTime: value?.[0] ?? null, endTime: value?.[1] ?? null })
}

const atDayStart = (parts: DateParts): DateParts => ({ ...parts, hour: 0, minute: 0, second: 0 })
const atDayEnd = (parts: DateParts): DateParts => ({ ...parts, hour: 23, minute: 59, second: 59 })

function open() {
  if (props.disabled) return
  hydrate()
  pop.show()
  nextTick(animate)
}

function animate() {
  nextTick(() => revealRows(panel.value?.querySelectorAll('.dt-cell') ?? []))
}

function pickDay(parts: DateParts) {
  if (!selectable(parts)) return
  const anchor = start.value
  if (!anchor || end.value) {
    // 重新开始一段区间：起点落在被点的日，终点待选
    start.value = atDayStart(parts)
    end.value = null
    hover.value = null
    view.value = { ...view.value, ...pickYm(parts) }
    return
  }
  const low = atDayStart(parts)
  if (compareDay(low, anchor) < 0) {
    // 点到起点之前：原来的起点改为终点
    start.value = low
    end.value = atDayEnd(anchor)
  } else {
    end.value = atDayEnd(parts)
  }
  hover.value = null
  emitValue()
  // 日期时间需要连同两个时间一起确认，保持面板打开
  if (!isDateTime.value) pop.hide(true)
}

function stepLeft(delta: number) {
  view.value = addMonths(view.value, delta)
  animate()
}

function stepBoth(delta: number) {
  view.value = addMonths(view.value, delta * 12)
  animate()
}

function applyPair(pair: [string, string] | null) {
  start.value = pair?.[0] ? parseDate(pair[0]) : null
  end.value = pair?.[1] ? parseDate(pair[1]) : null
  if (start.value) view.value = { ...view.value, ...pickYm(start.value) }
  emitValue()
}

function preset(days: number) {
  applyPair(presetRange(props.type, days))
  if (!isDateTime.value) pop.hide(true)
}

function presetMonth() {
  const now = todayParts()
  const low: DateParts = { ...now, day: 1, hour: 0, minute: 0, second: 0 }
  const high: DateParts = { ...now, hour: 23, minute: 59, second: 59 }
  applyPair([toCanonical(low, props.type), toCanonical(high, props.type)])
  if (!isDateTime.value) pop.hide(true)
}

function setTime(which: 'start' | 'end', part: 'hour' | 'minute' | 'second', raw: string) {
  const target = which === 'start' ? start : end
  const value = Number(raw)
  if (!Number.isFinite(value) || !target.value) return
  const limit = part === 'hour' ? 23 : 59
  target.value = { ...target.value, [part]: Math.min(limit, Math.max(0, Math.trunc(value))) }
}

function confirm() {
  emitValue()
  pop.hide(true)
}

function clear() {
  start.value = null
  end.value = null
  hover.value = null
  emit('update:modelValue', null)
  emit('change', { beginTime: null, endTime: null })
  trigger.value?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    // 范围框的回车含义是「确认这一段」，不允许冒泡成表单提交
    event.preventDefault()
    event.stopPropagation()
    if (!pop.open.value) {
      open()
      return
    }
    if (start.value && end.value) confirm()
    else pickDay(cursor.value)
    return
  }
  if (pop.onKeydown(event)) return
  if (!pop.open.value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    open()
    return
  }
  if (!pop.open.value) return
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (steps[event.key] !== undefined) {
    event.preventDefault()
    const next = shiftDay(cursor.value, steps[event.key])
    hover.value = next
    // 候选日走出双面板覆盖的两个月时，整组面板跟过去
    const right = addMonths(view.value, 1)
    if (compareDay(next, { ...view.value, day: 1 }) < 0) stepLeft(-1)
    else if (compareDay(next, { ...right, day: new Date(right.year, right.month, 0).getDate() }) > 0) stepLeft(1)
    else animate()
    return
  }
  if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    const delta = event.key === 'PageUp' ? -1 : 1
    if (event.shiftKey) stepBoth(delta)
    else stepLeft(delta)
  }
}

watch(() => props.modelValue, () => { if (!pop.open.value) hydrate() }, { immediate: true })

defineExpose({ open, close: () => pop.hide(), clear })
</script>

<template>
  <button
    ref="trigger"
    type="button"
    :class="['input-shell', 'range-input', invalid && 'is-invalid', disabled && 'is-disabled']"
    :disabled="disabled"
    aria-haspopup="dialog"
    :aria-expanded="pop.open.value"
    :aria-controls="panelId"
    :aria-invalid="invalid || undefined"
    @click="pop.open.value ? pop.hide(true) : open()"
    @keydown="onKeydown"
  >
    <svg class="range-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6h16v14H4V6zm0 4h16M8 3v4m8-4v4" />
    </svg>
    <span class="range-text">
      <template v-if="shown">
        <span class="range-endpoint tnum">{{ shown[0] }}</span>
        <span class="range-sep" aria-hidden="true">–</span>
        <span class="range-endpoint tnum">{{ shown[1] }}</span>
      </template>
      <span v-else class="range-placeholder">{{ placeholder }}</span>
    </span>
    <span
      v-if="clearable && shown && !disabled"
      class="input-clear"
      role="button"
      tabindex="-1"
      aria-label="清空"
      @click.stop="clear"
    ><Icon name="x" :size="14" /></span>
    <Icon v-else class="range-caret" name="chevronDown" :size="15" />
  </button>

  <Teleport to="body">
    <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
      <div
        v-if="pop.open.value"
        ref="panel"
        :id="panelId"
        class="range-panel m-float"
        role="dialog"
        aria-label="选择日期范围"
        :style="{ top: `${pop.pos.value.top}px`, left: `${pop.pos.value.left}px`, zIndex: pop.layer() }"
        @keydown="onKeydown"
      >
        <div class="dr-panes">
          <section class="dr-pane">
            <div class="dt-head">
              <span class="dt-nav">
                <button type="button" class="dt-btn" aria-label="上一年" @click="stepBoth(-1)">
                  <Icon name="chevronLeft" :size="12" /><Icon name="chevronLeft" :size="12" />
                </button>
                <button type="button" class="dt-btn" aria-label="上一月" @click="stepLeft(-1)">
                  <Icon name="chevronLeft" :size="14" />
                </button>
              </span>
              <span class="dt-title tnum">{{ leftTitle }}</span>
              <span class="dt-nav dt-nav-ghost" aria-hidden="true" />
            </div>
            <div class="dt-week"><span v-for="w in weekHead" :key="`l${w}`">{{ w }}</span></div>
            <div class="dt-grid">
              <button
                v-for="cell in leftCells"
                :key="`l${cell.key}`"
                type="button"
                role="gridcell"
                :class="['dt-cell', cellClass(cell)]"
                :aria-selected="isEdge(cell.parts, 'start') || isEdge(cell.parts, 'end')"
                :aria-disabled="!selectable(cell.parts) || undefined"
                tabindex="-1"
                @click="pickDay(cell.parts)"
                @pointerenter="hover = cell.parts"
              >{{ cell.parts.day }}</button>
            </div>
            <div v-if="isDateTime" class="dt-time">
              <span class="dt-time-label">开始</span>
              <input class="time-field tnum" :value="String(start?.hour ?? 0).padStart(2, '0')" aria-label="开始时" maxlength="2" @input="setTime('start', 'hour', ($event.target as HTMLInputElement).value)">
              <span class="dt-colon" aria-hidden="true">:</span>
              <input class="time-field tnum" :value="String(start?.minute ?? 0).padStart(2, '0')" aria-label="开始分" maxlength="2" @input="setTime('start', 'minute', ($event.target as HTMLInputElement).value)">
              <span class="dt-colon" aria-hidden="true">:</span>
              <input class="time-field tnum" :value="String(start?.second ?? 0).padStart(2, '0')" aria-label="开始秒" maxlength="2" @input="setTime('start', 'second', ($event.target as HTMLInputElement).value)">
            </div>
          </section>

          <section class="dr-pane">
            <div class="dt-head">
              <span class="dt-nav dt-nav-ghost" aria-hidden="true" />
              <span class="dt-title tnum">{{ rightTitle }}</span>
              <span class="dt-nav">
                <button type="button" class="dt-btn" aria-label="下一月" @click="stepLeft(1)">
                  <Icon name="chevronRight" :size="14" />
                </button>
                <button type="button" class="dt-btn" aria-label="下一年" @click="stepBoth(1)">
                  <Icon name="chevronRight" :size="12" /><Icon name="chevronRight" :size="12" />
                </button>
              </span>
            </div>
            <div class="dt-week"><span v-for="w in weekHead" :key="`r${w}`">{{ w }}</span></div>
            <div class="dt-grid">
              <button
                v-for="cell in rightCells"
                :key="`r${cell.key}`"
                type="button"
                role="gridcell"
                :class="['dt-cell', cellClass(cell)]"
                :aria-selected="isEdge(cell.parts, 'start') || isEdge(cell.parts, 'end')"
                :aria-disabled="!selectable(cell.parts) || undefined"
                tabindex="-1"
                @click="pickDay(cell.parts)"
                @pointerenter="hover = cell.parts"
              >{{ cell.parts.day }}</button>
            </div>
            <div v-if="isDateTime" class="dt-time">
              <span class="dt-time-label">结束</span>
              <input class="time-field tnum" :value="String(end?.hour ?? 23).padStart(2, '0')" aria-label="结束时" maxlength="2" @input="setTime('end', 'hour', ($event.target as HTMLInputElement).value)">
              <span class="dt-colon" aria-hidden="true">:</span>
              <input class="time-field tnum" :value="String(end?.minute ?? 59).padStart(2, '0')" aria-label="结束分" maxlength="2" @input="setTime('end', 'minute', ($event.target as HTMLInputElement).value)">
              <span class="dt-colon" aria-hidden="true">:</span>
              <input class="time-field tnum" :value="String(end?.second ?? 59).padStart(2, '0')" aria-label="结束秒" maxlength="2" @input="setTime('end', 'second', ($event.target as HTMLInputElement).value)">
            </div>
          </section>
        </div>

        <footer class="dt-foot">
          <div class="dr-presets">
            <button type="button" class="btn btn-text btn-sm" @click="preset(1)">今天</button>
            <button type="button" class="btn btn-text btn-sm" @click="preset(7)">近 7 天</button>
            <button type="button" class="btn btn-text btn-sm" @click="preset(30)">近 30 天</button>
            <button type="button" class="btn btn-text btn-sm" @click="presetMonth">本月</button>
          </div>
          <span class="dt-foot-gap" />
          <button type="button" class="btn btn-text btn-sm" :disabled="!shown" @click="clear">清空</button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="!start || !end" @click="confirm">确定</button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.range-input { width: 100%; cursor: pointer; justify-content: flex-start; text-align: left; color: var(--ink); }
.range-input .range-glyph { color: var(--ink-soft); flex: none; }
.range-text { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; overflow: hidden; }
.range-endpoint { font-size: 12.5px; white-space: nowrap; }
.range-sep { color: var(--ink-faint); }
.range-placeholder { color: var(--ink-faint); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.range-caret { color: var(--ink-soft); flex: none; }

.range-panel { position: fixed; width: 560px; max-width: calc(100vw - 16px); padding: 10px; border-radius: var(--r-md); }
.dr-panes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

.dt-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 0 2px 8px; }
.dt-title { font-size: 13px; font-weight: 650; color: var(--ink); }
.dt-nav { display: inline-flex; gap: 2px; }
.dt-nav-ghost { width: 54px; }
.dt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  color: var(--ink-soft);
  transition: color .2s ease, background .2s ease;
}
.dt-btn:hover { color: var(--ink); background: var(--hover-bg); }

.dt-week { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 2px; }
.dt-week span { height: 22px; line-height: 22px; text-align: center; font-size: 11px; color: var(--ink-soft); }
.dt-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dt-cell {
  height: 30px;
  border-radius: var(--r-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12.5px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease;
}
.dt-cell:hover:not(.is-disabled) { background: var(--hover-bg); }
.dt-cell.is-muted { color: var(--ink-faint); }
.dt-cell.is-edge { color: #fff; font-weight: 660; background: var(--blue); box-shadow: var(--e-accent); }
.dt-cell.is-inside { background: var(--blue-soft); color: var(--blue); border-radius: 0; }
.dt-cell.is-cursor { box-shadow: inset 0 0 0 1.5px var(--blue); }
.dt-cell.is-preview.is-inside { background: var(--lime-soft); color: var(--leaf-text); }
.dt-cell.is-disabled { color: var(--ink-faint); cursor: not-allowed; background: none; }

.dt-time { display: flex; align-items: center; gap: 5px; padding: 9px 2px 2px; }
.dt-time-label { font-size: 11.5px; color: var(--ink-soft); margin-right: 2px; }
.dt-colon { color: var(--ink-faint); }
.time-field {
  width: 32px;
  height: 27px;
  text-align: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-xs);
  background: var(--input-bg);
  color: var(--ink);
  font-size: 12.5px;
  outline: none;
  transition: border-color .2s ease;
}
.time-field:hover { border-color: rgba(var(--shade), .18); }
.time-field:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

.dt-foot { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.dr-presets { display: inline-flex; gap: 2px; flex-wrap: wrap; }
.dt-foot-gap { flex: 1; }

@media (max-width: 620px) {
  .dr-panes { grid-template-columns: minmax(0, 1fr); }
  .dt-nav-ghost { display: none; }
}
</style>
