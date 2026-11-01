<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { overlayEnter, overlayLeave, revealRows } from '@/composables/motion'
import { usePopover } from '@/composables/popover'
import {
  MONTH_LABELS, WEEK_HEAD, addMonths, isSameDayKey, monthGrid, monthLabel, normalize, parseDate,
  shiftDay, toCanonical, todayParts, withinLimit, yearGrid,
  type DateKind, type DateParts,
} from '@/composables/dateValue'

/* ============================================================
   日期选择器：文本框 + 浮层日历，替代 el-date-picker 的单值形态。
   原生 <input type="date"> 不可用：格式与外观都跟不上设计语言。
   取值一律规范字符串：date / dateMonth / year → YYYY-MM-DD，
   datetime → YYYY-MM-DD HH:mm:ss（选完日要点「确定」一并带出时间）。
   ============================================================ */

export interface DateInputProps {
  /** 允许 null：后端可空日期列直接绑定，清空统一回传 '' */
  modelValue?: string | null
  /** date = 某日，datetime = 某日时刻，dateMonth = 当月 1 日，year = 当年 1 月 1 日 */
  type?: DateKind
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  /** 可选下界（YYYY-MM-DD，按天生效） */
  min?: string
  /** 可选上界（YYYY-MM-DD，按天生效） */
  max?: string
  invalid?: boolean
  readonly?: boolean
}

const props = withDefaults(defineProps<DateInputProps>(), {
  modelValue: '',
  type: 'date',
  placeholder: '请选择日期',
  clearable: true,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const input = ref<HTMLInputElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const grid = ref<HTMLElement | null>(null)
const pop = usePopover({ trigger, panel, minWidth: 268 })
const panelId = `dt-${Math.random().toString(36).slice(2, 8)}`

/** 面板当前聚焦的年月（也是 datetime 正在拼装的日子） */
const cursor = ref<DateParts>(todayParts())
/** 手输草稿：非 null 表示用户正在输入，失焦 / 回车后回填规范串 */
const draft = ref<string | null>(null)

const modelParts = computed(() => parseDate(props.modelValue ?? ''))
const isDateTime = computed(() => props.type === 'datetime')
const isMonth = computed(() => props.type === 'dateMonth')
const isYear = computed(() => props.type === 'year')

const shown = computed(() => {
  if (draft.value !== null) return draft.value
  return modelParts.value ? toCanonical(modelParts.value, props.type) : ''
})

const title = computed(() => {
  if (isYear.value) {
    const start = Math.floor(cursor.value.year / 10) * 10
    return `${start} 年 – ${start + 9} 年`
  }
  if (isMonth.value) return `${cursor.value.year} 年`
  return `${cursor.value.year} 年 ${monthLabel(cursor.value.month)}`
})

interface Cell { parts: DateParts; key: string; muted?: boolean; label?: string }

const cells = computed<Cell[]>(() => {
  if (isYear.value) return yearGrid(cursor.value.year).map(parts => ({ parts, key: String(parts.year) }))
  if (isMonth.value) {
    return MONTH_LABELS.map((label, index) => ({
      parts: { ...cursor.value, month: index + 1, day: 1 },
      key: String(index + 1),
      label,
    }))
  }
  return monthGrid(cursor.value.year, cursor.value.month)
    .map(cell => ({ parts: cell.parts, key: cell.key, muted: !cell.inCurrentMonth }))
})

const weekHead = WEEK_HEAD

function isSelected(parts: DateParts) {
  return isSameDayKey(modelParts.value, parts, props.type)
}
function isNow(parts: DateParts) {
  return isSameDayKey(todayParts(), parts, props.type)
}
function selectable(parts: DateParts) {
  if (props.disabled || props.readonly) return false
  if (isYear.value) return withinLimit({ year: parts.year, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, props.min, props.max)
  if (isMonth.value) return withinLimit({ ...parts, day: 1 }, props.min, props.max)
  return withinLimit(parts, props.min, props.max)
}

function animateGrid() {
  nextTick(() => revealRows(grid.value?.querySelectorAll('.dt-cell') ?? []))
}

function open() {
  if (props.disabled || props.readonly) return
  cursor.value = modelParts.value ?? cursor.value
  pop.show()
  nextTick(animateGrid)
}

function commit(parts: DateParts) {
  draft.value = null
  emit('update:modelValue', toCanonical(parts, props.type))
}

function pick(parts: DateParts) {
  if (!selectable(parts)) return
  cursor.value = isDateTime.value ? { ...parts, hour: cursor.value.hour, minute: cursor.value.minute, second: cursor.value.second } : parts
  if (isDateTime.value) return
  commit(parts)
  pop.hide(true)
}

function stepMonth(delta: number) {
  cursor.value = addMonths(cursor.value, delta)
  animateGrid()
}

function stepYear(delta: number) {
  if (isYear.value) cursor.value = { ...cursor.value, year: cursor.value.year + delta * 10 }
  else cursor.value = addMonths(cursor.value, delta * 12)
  animateGrid()
}

function jumpToday() {
  const parts = todayParts()
  cursor.value = parts
  if (isDateTime.value) {
    animateGrid()
    return
  }
  if (selectable(parts)) {
    commit(parts)
    pop.hide(true)
  }
}

function confirmDateTime() {
  commit(cursor.value)
  pop.hide(true)
}

function setTime(part: 'hour' | 'minute' | 'second', raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const limit = part === 'hour' ? 23 : 59
  cursor.value = { ...cursor.value, [part]: Math.min(limit, Math.max(0, Math.trunc(value))) }
}

function clear() {
  draft.value = null
  emit('update:modelValue', '')
  input.value?.focus({ preventScroll: true })
}

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}

/** 手输容错：2026-3-5 / 2026/03/05 8:30 / 2026年3月5日 / 2026-03 / 2026 都能落到规范串；不合法则还原 */
function commitDraft() {
  const raw = draft.value
  if (raw === null) return
  draft.value = null
  if (raw.trim() === '') {
    if (props.modelValue) emit('update:modelValue', '')
    return
  }
  const parsed = normalize(raw, props.type)
  if (!parsed) return
  const parts = parseDate(parsed)
  if (parts) cursor.value = parts
  if (parsed !== props.modelValue) emit('update:modelValue', parsed)
}

/** 方向键移动候选日：日面板按 7 列跨周，月 / 年面板按 4 列 */
function moveCursor(step: number, across: boolean) {
  if (isYear.value) cursor.value = { ...cursor.value, year: cursor.value.year + step * (across ? 4 : 1) }
  else if (isMonth.value) cursor.value = addMonths(cursor.value, step * (across ? 4 : 1))
  else {
    const next = shiftDay(cursor.value, step * (across ? 1 : 7))
    const crossed = next.month !== cursor.value.month || next.year !== cursor.value.year
    cursor.value = next
    if (crossed) {
      animateGrid()
      return
    }
  }
  animateGrid()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    // 日期框的回车含义是「选定这一项」，不允许冒泡成表单提交
    event.preventDefault()
    event.stopPropagation()
    if (draft.value !== null && draft.value.trim()) {
      commitDraft()
      return
    }
    if (!pop.open.value) {
      open()
      return
    }
    if (isDateTime.value) confirmDateTime()
    else pick(cursor.value)
    return
  }
  if (pop.onKeydown(event)) return
  if (event.key === 'Tab') {
    commitDraft()
    pop.hide()
    return
  }
  if (!pop.open.value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    open()
    return
  }
  if (!pop.open.value) return
  const steps: Record<string, [number, boolean]> = {
    ArrowLeft: [-1, true],
    ArrowRight: [1, true],
    ArrowUp: [-1, false],
    ArrowDown: [1, false],
  }
  if (steps[event.key]) {
    event.preventDefault()
    moveCursor(...steps[event.key])
    return
  }
  if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    const delta = event.key === 'PageUp' ? -1 : 1
    if (event.shiftKey) stepYear(delta)
    else if (isYear.value || isMonth.value) stepYear(delta)
    else stepMonth(delta)
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const last = new Date(cursor.value.year, cursor.value.month, 0).getDate()
    cursor.value = { ...cursor.value, day: event.key === 'Home' ? 1 : last }
  }
}

watch(() => props.modelValue, () => { draft.value = null })

defineExpose({
  focus: () => input.value?.focus(),
  open,
  close: () => pop.hide(),
})
</script>

<template>
  <span
    ref="trigger"
    :class="['input-shell', 'date-input', invalid && 'is-invalid', disabled && 'is-disabled']"
    @click="disabled || readonly ? undefined : open()"
  >
    <svg class="date-glyph" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6h16v14H4V6zm0 4h16M8 3v4m8-4v4" />
    </svg>
    <input
      ref="input"
      class="date-value"
      :value="shown"
      type="text"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      aria-haspopup="dialog"
      :aria-expanded="pop.open.value"
      :aria-controls="panelId"
      :aria-invalid="invalid || undefined"
      @input="onInput"
      @blur="commitDraft"
      @keydown="onKeydown"
    />
    <button
      v-if="clearable && modelValue && !disabled && !readonly"
      type="button"
      class="input-clear"
      aria-label="清空"
      @click.stop="clear"
    ><Icon name="x" :size="14" /></button>
  </span>

  <Teleport to="body">
    <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
      <div
        v-if="pop.open.value"
        ref="panel"
        :id="panelId"
        class="date-panel m-float"
        role="dialog"
        aria-label="选择日期"
        :style="{ top: `${pop.pos.value.top}px`, left: `${pop.pos.value.left}px`, zIndex: pop.layer() }"
        @keydown="onKeydown"
      >
        <div class="dt-head">
          <span class="dt-nav">
            <button type="button" class="dt-btn" :aria-label="isYear || isMonth ? '上一年' : '上一年（快退）'" @click="stepYear(-1)">
              <Icon name="chevronLeft" :size="12" /><Icon name="chevronLeft" :size="12" />
            </button>
            <button v-if="!isYear && !isMonth" type="button" class="dt-btn" aria-label="上一月" @click="stepMonth(-1)">
              <Icon name="chevronLeft" :size="14" />
            </button>
          </span>
          <span class="dt-title tnum">{{ title }}</span>
          <span class="dt-nav">
            <button v-if="!isYear && !isMonth" type="button" class="dt-btn" aria-label="下一月" @click="stepMonth(1)">
              <Icon name="chevronRight" :size="14" />
            </button>
            <button type="button" class="dt-btn" :aria-label="isYear || isMonth ? '下一年' : '下一年（快进）'" @click="stepYear(1)">
              <Icon name="chevronRight" :size="12" /><Icon name="chevronRight" :size="12" />
            </button>
          </span>
        </div>

        <div v-if="!isYear && !isMonth" class="dt-week" aria-hidden="true">
          <span v-for="w in weekHead" :key="w">{{ w }}</span>
        </div>

        <div
          ref="grid"
          :class="['dt-grid', (isMonth || isYear) && 'is-coarse']"
          role="grid"
          :aria-label="isYear ? '选择年份' : isMonth ? '选择月份' : '选择日期'"
        >
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            role="gridcell"
            :class="[
              'dt-cell',
              cell.muted && 'is-muted',
              isSelected(cell.parts) && 'is-active',
              !isSelected(cell.parts) && isSameDayKey(cursor, cell.parts, type) && 'is-cursor',
              isNow(cell.parts) && 'is-today',
              !selectable(cell.parts) && 'is-disabled',
            ]"
            :aria-selected="isSelected(cell.parts)"
            :aria-disabled="!selectable(cell.parts) || undefined"
            tabindex="-1"
            @click="pick(cell.parts)"
            @pointerenter="cursor = cell.parts"
          >{{ isYear ? cell.parts.year : isMonth ? cell.label : cell.parts.day }}</button>
        </div>

        <div v-if="isDateTime" class="dt-time">
          <span class="dt-time-label">时间</span>
          <input class="time-field tnum" :value="String(cursor.hour).padStart(2, '0')" aria-label="时" maxlength="2" @input="setTime('hour', ($event.target as HTMLInputElement).value)">
          <span class="dt-colon" aria-hidden="true">:</span>
          <input class="time-field tnum" :value="String(cursor.minute).padStart(2, '0')" aria-label="分" maxlength="2" @input="setTime('minute', ($event.target as HTMLInputElement).value)">
          <span class="dt-colon" aria-hidden="true">:</span>
          <input class="time-field tnum" :value="String(cursor.second).padStart(2, '0')" aria-label="秒" maxlength="2" @input="setTime('second', ($event.target as HTMLInputElement).value)">
        </div>

        <footer class="dt-foot">
          <button type="button" class="btn btn-text btn-sm" @click="jumpToday">{{ isDateTime ? '此刻' : '今天' }}</button>
          <span class="dt-foot-gap" />
          <button v-if="clearable" type="button" class="btn btn-text btn-sm" :disabled="!modelValue" @click="clear">清空</button>
          <button v-if="isDateTime" type="button" class="btn btn-primary btn-sm" @click="confirmDateTime">确定</button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 外壳复用 .input-shell / .input-clear，这里只补日历几何与配色 */
.date-input { cursor: pointer; color: var(--ink); }
.date-input .date-glyph { color: var(--ink-soft); flex: none; }
.date-input .date-value { cursor: text; font-variant-numeric: tabular-nums; }

.date-panel { position: fixed; width: 268px; padding: 8px; border-radius: var(--r-md); }
.dt-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 0 2px 8px; }
.dt-title { font-size: 13px; font-weight: 650; color: var(--ink); }
.dt-nav { display: inline-flex; gap: 2px; }
.dt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
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
.dt-grid.is-coarse { grid-template-columns: repeat(4, 1fr); }
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
.dt-grid.is-coarse .dt-cell { height: 34px; }
.dt-cell:hover:not(.is-disabled) { background: var(--hover-bg); }
.dt-cell.is-muted { color: var(--ink-faint); }
.dt-cell.is-today { color: var(--blue); font-weight: 660; }
.dt-cell.is-cursor { box-shadow: inset 0 0 0 1.5px var(--blue); }
.dt-cell.is-active { color: #fff; font-weight: 660; background: var(--blue); box-shadow: var(--e-accent); }
.dt-cell.is-disabled { color: var(--ink-faint); cursor: not-allowed; background: none; }

.dt-time { display: flex; align-items: center; gap: 5px; padding: 9px 2px 2px; }
.dt-time-label { font-size: 11.5px; color: var(--ink-soft); margin-right: 2px; }
.dt-colon { color: var(--ink-faint); }
.time-field {
  width: 34px;
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

.dt-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.dt-foot-gap { flex: 1; }
</style>
