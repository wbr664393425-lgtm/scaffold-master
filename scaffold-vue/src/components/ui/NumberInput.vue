<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

/* ============================================================
   数字输入：替代 el-input-number（金额 / 比例 / 折扣 / 排序）。
   用 type=text + inputmode=decimal 自己解析，避免原生 number 输入框
   在中文输入法与「1.」这类中间态下丢字符；小数位按 precision 取整，
   不做 value * step 的浮点直乘，杜绝 0.1 + 0.2 漂移。
   ============================================================ */

export interface NumberInputProps {
  modelValue?: number | null
  min?: number
  max?: number
  step?: number
  /** 小数位；不传时按 step 的小数位推断（与 el-input-number 一致） */
  precision?: number
  disabled?: boolean
  readonly?: boolean
  /** 是否显示右侧加减按钮 */
  controls?: boolean
  invalid?: boolean
  placeholder?: string
  clearable?: boolean
  /** 单位后缀，如 元 / % / 折 */
  unit?: string
}

const props = withDefaults(defineProps<NumberInputProps>(), {
  modelValue: null,
  min: -Infinity,
  max: Infinity,
  step: 1,
  controls: true,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
  (e: 'enter'): void
}>()

const el = ref<HTMLInputElement | null>(null)
/** 输入中的原样文本：只在失焦或回车时回填规范值 */
const draft = ref<string | null>(null)

const decimals = computed(() => {
  if (props.precision !== undefined) return Math.max(0, Math.trunc(props.precision))
  const fromStep = String(props.step).split('.')[1]
  return fromStep ? fromStep.length : 0
})

/** 按精度取整：先放大成整数再缩放，避开浮点直乘 */
function quantize(value: number) {
  const p = decimals.value
  if (!Number.isFinite(value)) return 0
  if (p === 0) return Math.round(value)
  const scale = 10 ** p
  // 先削掉 12 位有效数字，浮点噪声（…99999999 / …00000001）在这一步归零
  const cleaned = Number(value.toPrecision(12))
  return Math.round(cleaned * scale) / scale
}

const clamp = (value: number) => Math.min(props.max, Math.max(props.min, value))

const display = computed(() => {
  if (draft.value !== null) return draft.value
  const value = props.modelValue
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return decimals.value > 0 ? value.toFixed(decimals.value) : String(value)
})

function parse(raw: string): number | null {
  const text = raw.trim().replace(/。/g, '.').replace(/[，,]/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? quantize(clamp(value)) : null
}

function commit(raw: string) {
  const value = parse(raw)
  emit('update:modelValue', value)
  return value
}

function onInput(event: Event) {
  const el = event.target as HTMLInputElement
  const raw = el.value
  // 允许 - . 12 这类中间态存在，不做即时格式化回写；非法字符就地退回上一稿
  if (raw && !/^-?\d*[.,]?\d*$/.test(raw)) {
    el.value = draft.value ?? display.value
    return
  }
  draft.value = raw
  const value = raw ? parse(raw) : null
  if (value !== null && raw.includes('.') && raw.endsWith('.')) return
  emit('update:modelValue', value)
}

function onBlur() {
  const raw = draft.value
  draft.value = null
  if (raw === null) {
    // 没改过文本，也把手输留下的越界 / 超精度值收敛一次
    if (props.modelValue !== null && props.modelValue !== undefined) emit('update:modelValue', quantize(clamp(props.modelValue)))
    return
  }
  commit(raw)
}

const canUp = computed(() => props.modelValue === null || props.modelValue === undefined || props.modelValue < props.max)
const canDown = computed(() => props.modelValue === null || props.modelValue === undefined || props.modelValue > props.min)

function move(delta: number) {
  if (props.disabled || props.readonly) return
  const base = props.modelValue
  const next = base === null || base === undefined || Number.isNaN(base)
    ? quantize(clamp(0))
    : quantize(clamp(base + delta * props.step))
  draft.value = null
  emit('update:modelValue', next)
}

function clear() {
  draft.value = null
  emit('update:modelValue', null)
  el.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    move(event.key === 'ArrowUp' ? 1 : -1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    emit('enter')
  }
}

defineExpose({ focus: () => el.value?.focus(), stepUp: () => move(1), stepDown: () => move(-1) })
</script>

<template>
  <span :class="['input-shell', 'num-input', invalid && 'is-invalid', disabled && 'is-disabled']">
    <input
      ref="el"
      class="num-field tnum"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :value="display"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :aria-label="unit ? `${placeholder || '数值'}（${unit}）` : (placeholder || '数值')"
      :aria-invalid="invalid || undefined"
      :aria-valuemin="Number.isFinite(min) ? min : undefined"
      :aria-valuemax="Number.isFinite(max) ? max : undefined"
      @input="onInput"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <span v-if="unit" class="num-unit">{{ unit }}</span>
    <button
      v-if="clearable && modelValue !== null && modelValue !== undefined && !disabled && !readonly"
      type="button"
      class="input-clear"
      aria-label="清空"
      @click.stop="clear"
    ><Icon name="x" :size="14" /></button>
    <span v-if="controls" class="num-stepper">
      <button type="button" class="num-btn icon-btn icon-btn-sm" :disabled="disabled || readonly || !canUp" aria-label="增加" @click="move(1)">
        <Icon name="arrowUp" :size="13" :stroke="2.2" />
      </button>
      <button type="button" class="num-btn icon-btn icon-btn-sm" :disabled="disabled || readonly || !canDown" aria-label="减少" @click="move(-1)">
        <Icon name="arrowDown" :size="13" :stroke="2.2" />
      </button>
    </span>
  </span>
</template>

<style scoped>
.num-input { padding-right: 4px; }
.num-field { text-align: left; font-variant-numeric: tabular-nums; }
.num-unit { flex: none; font-size: 11.5px; color: var(--ink-soft); }
.num-stepper {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: none;
  margin-left: 2px;
}
.num-btn { width: 22px; height: 15px; border-radius: 5px; }
.num-btn:disabled { opacity: .35; }
</style>
