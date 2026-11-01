<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { drawPath, gsap, motionSkipped, EASE } from '@/composables/motion'

/* 纯 SVG 趋势图：按容器真实宽度计算路径，线宽不被拉伸。
   - 数据切换时折线从旧形态形变到新形态（导 Conduct），不是擦掉重画
   - 悬停十字准星 + 毛玻璃读数，读数用 quickTo 平滑跟随
   - secondary 为第二条序列（如失败数），以虚线叠加；band 为斜线填充区间
   - 稀疏数据（非零点 ≤ 3 且点数 > 6）改画茎叶点并直接标数值，避免贴底折线末端一根尖刺 */
const props = withDefaults(defineProps<{
  values: number[]
  labels: string[]
  secondary?: number[]
  secondaryLabel?: string
  primaryLabel?: string
  height?: number
  unit?: string
  band?: [number, number] | null
  /** 固定纵轴上限；不传则按峰值自适应。百分比一类的有界序列用它锁到 100 */
  max?: number | null
  /** 节点圆点：自动（点数 ≤ 12 时全部显示，否则只显示末点） */
  dots?: boolean
  tone?: 'blue' | 'ink'
}>(), {
  height: 220,
  unit: '',
  band: null,
  max: null,
  dots: true,
  tone: 'blue',
  primaryLabel: '数值',
  secondaryLabel: '失败',
})

const box = ref<HTMLElement | null>(null)
const line = ref<SVGPathElement | null>(null)
const area = ref<SVGPathElement | null>(null)
const tip = ref<HTMLElement | null>(null)
const width = ref(600)
const hover = ref<number | null>(null)
const uid = Math.random().toString(36).slice(2, 8)
const PAD = { top: 18, right: 14, bottom: 28, left: 38 }

/* 纵轴取整：至少留 15% 顶部余量，刻度步长取 1 / 2 / 5 × 10ⁿ */
function niceStep(raw: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const r = raw / magnitude
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * magnitude
}
const scale = computed(() => {
  const peak = Math.max(1, ...props.values, ...(props.secondary ?? []))
  // 有界序列（百分比等）固定上限，避免自适应把纵轴抬到 150% 这种读不通的刻度
  if (props.max && props.max > 0) {
    const step = Math.max(1, niceStep(props.max / 4))
    return { step, max: Math.max(props.max, step) }
  }
  const step = Math.max(1, niceStep((peak * 1.15) / 4))
  const max = step * Math.max(1, Math.ceil((peak * 1.15) / step))
  return { step, max }
})
const innerW = computed(() => Math.max(10, width.value - PAD.left - PAD.right))
const innerH = computed(() => props.height - PAD.top - PAD.bottom)

const xAt = (i: number, n: number) => PAD.left + (n <= 1 ? innerW.value / 2 : (i / (n - 1)) * innerW.value)
const yAt = (v: number) => PAD.top + innerH.value - (v / scale.value.max) * innerH.value

const target = computed(() => props.values.map((v, i) => ({ x: xAt(i, props.values.length), y: yAt(v) })))
const target2 = computed(() => (props.secondary ?? []).map((v, i) => ({ x: xAt(i, props.secondary!.length), y: yAt(v) })))

/* 正在绘制的点列：形变期间由补间推进，静止时等于 target */
type Pt = { x: number; y: number }
const shown = shallowRef<Pt[]>([])
const shown2 = shallowRef<Pt[]>([])

function resample(points: Pt[], n: number): Pt[] {
  if (!points.length) return Array.from({ length: n }, (_, i) => ({ x: xAt(i, n), y: PAD.top + innerH.value }))
  return Array.from({ length: n }, (_, i) => {
    const pos = n <= 1 ? 0 : (i / (n - 1)) * (points.length - 1)
    const a = points[Math.floor(pos)]
    const b = points[Math.min(points.length - 1, Math.ceil(pos))]
    const t = pos - Math.floor(pos)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  })
}

let morph: gsap.core.Tween | null = null
let drawn = false
function morphTo() {
  morph?.kill()
  const to = target.value
  const to2 = target2.value
  if (!drawn || motionSkipped()) {
    shown.value = to
    shown2.value = to2
    if (!drawn && to.length) {
      drawn = true
      nextTick(() => drawPath(line.value, area.value))
    }
    return
  }
  const from = resample(shown.value, to.length)
  const from2 = resample(shown2.value, to2.length)
  const state = { t: 0 }
  morph = gsap.to(state, {
    t: 1,
    duration: 0.72,
    ease: EASE.swap,
    onUpdate: () => {
      shown.value = to.map((p, i) => ({ x: from[i].x + (p.x - from[i].x) * state.t, y: from[i].y + (p.y - from[i].y) * state.t }))
      shown2.value = to2.map((p, i) => ({ x: from2[i].x + (p.x - from2[i].x) * state.t, y: from2[i].y + (p.y - from2[i].y) * state.t }))
    },
  })
}

function smooth(pts: Pt[]) {
  if (!pts.length) return ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i - 1]
    const c = pts[i]
    const mx = (p.x + c.x) / 2
    d += ` C${mx},${p.y} ${mx},${c.y} ${c.x},${c.y}`
  }
  return d
}

const linePath = computed(() => smooth(shown.value))
const line2Path = computed(() => smooth(shown2.value))
const areaPath = computed(() => {
  const pts = shown.value
  if (!pts.length) return ''
  const base = PAD.top + innerH.value
  return `${smooth(pts)} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`
})
const ticks = computed(() => {
  const list: Array<{ y: number; label: number }> = []
  for (let v = 0; v <= scale.value.max; v += scale.value.step) list.push({ y: yAt(v), label: v })
  return list
})
const xLabels = computed(() => {
  const n = props.labels.length
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW.value / 70))))
  return props.labels.map((label, i) => ({ label, i })).filter(({ i }) => i % step === 0 || i === n - 1)
})
const showAllDots = computed(() => props.dots && props.values.length <= 12)
const sparse = computed(() => props.values.length > 6 && props.values.filter(v => v > 0).length <= 3 && props.values.some(v => v > 0))
const stems = computed(() => target.value.map((p, i) => ({ ...p, i, v: props.values[i], v2: props.secondary?.[i] ?? 0, y2: props.secondary ? yAt(props.secondary[i] ?? 0) : 0 })))
const bandRect = computed(() => {
  if (!props.band || props.values.length < 2) return null
  const [a, b] = props.band
  const x1 = xAt(Math.max(0, a), props.values.length)
  const x2 = xAt(Math.min(props.values.length - 1, b), props.values.length)
  return { x: Math.min(x1, x2), w: Math.max(2, Math.abs(x2 - x1)) }
})

/* ── 准星读数：quickTo 平滑跟随（跟随类保持 power3.out） ── */
let tipX: ((v: number) => void) | null = null
let tipY: ((v: number) => void) | null = null
function onMove(event: PointerEvent) {
  const rect = box.value?.getBoundingClientRect()
  const pts = target.value
  if (!rect || !pts.length) return
  const x = event.clientX - rect.left
  let nearest = 0
  pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(pts[nearest].x - x)) nearest = i })
  const first = hover.value === null
  hover.value = nearest
  nextTick(() => {
    if (!tip.value) return
    const tw = tip.value.offsetWidth
    const tx = Math.min(Math.max(pts[nearest].x - tw / 2, 0), width.value - tw)
    const ty = Math.max(pts[nearest].y - tip.value.offsetHeight - 14, 0)
    if (first || !tipX || !tipY || motionSkipped()) {
      gsap.set(tip.value, { x: tx, y: ty })
      tipX = gsap.quickTo(tip.value, 'x', { duration: 0.32, ease: 'power3.out' })
      tipY = gsap.quickTo(tip.value, 'y', { duration: 0.32, ease: 'power3.out' })
    } else {
      tipX(tx)
      tipY(ty)
    }
  })
}
function onLeave() {
  hover.value = null
  tipX = tipY = null
}

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(entries => {
    width.value = Math.round(entries[0].contentRect.width)
    morph?.kill()
    shown.value = target.value
    shown2.value = target2.value
  })
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  morph?.kill()
})

watch(() => [props.values, props.secondary], morphTo, { immediate: true })
</script>

<template>
  <div
    ref="box"
    :class="['trend', `tone-${tone}`]"
    :style="{ height: `${height}px` }"
    @pointermove="onMove"
    @pointerleave="onLeave"
  >
    <svg :width="width" :height="height" role="img" :aria-label="`趋势图，峰值 ${Math.max(0, ...values)}${unit}`">
      <defs>
        <linearGradient :id="`tg-${uid}`" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" class="trend-stop" stop-opacity=".2" />
          <stop offset="100%" class="trend-stop" stop-opacity="0" />
        </linearGradient>
        <pattern :id="`th-${uid}`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" class="hatch-line" />
        </pattern>
      </defs>
      <g class="trend-grid">
        <line v-for="t in ticks" :key="t.y" :x1="PAD.left" :x2="width - PAD.right" :y1="t.y" :y2="t.y" />
      </g>
      <rect v-if="bandRect" :x="bandRect.x" :y="PAD.top" :width="bandRect.w" :height="innerH" :fill="`url(#th-${uid})`" class="trend-band" />
      <g class="trend-axis">
        <text v-for="t in ticks" :key="`l${t.y}`" :x="PAD.left - 10" :y="t.y + 3.5" text-anchor="end">{{ t.label }}</text>
        <text v-for="l in xLabels" :key="`x${l.i}`" :x="target[l.i]?.x" :y="height - 8" text-anchor="middle">{{ l.label }}</text>
      </g>
      <g v-if="sparse" class="trend-stems">
        <line class="trend-base" :x1="PAD.left" :x2="width - PAD.right" :y1="PAD.top + innerH" :y2="PAD.top + innerH" />
        <template v-for="st in stems" :key="`s${st.i}`">
          <circle v-if="!st.v" class="trend-tick" :cx="st.x" :cy="PAD.top + innerH" r="1.6" />
          <g v-else>
            <line class="trend-stem" :x1="st.x" :x2="st.x" :y1="PAD.top + innerH" :y2="st.y" />
            <line v-if="st.v2" class="trend-stem is-secondary" :x1="st.x + 3" :x2="st.x + 3" :y1="PAD.top + innerH" :y2="st.y2" />
            <circle class="trend-dot" :cx="st.x" :cy="st.y" r="4.5" />
            <text class="trend-stem-label" :x="st.x" :y="st.y - 12" text-anchor="middle">{{ st.v }}{{ unit }}</text>
          </g>
        </template>
      </g>
      <path v-show="!sparse" ref="area" :d="areaPath" :fill="`url(#tg-${uid})`" />
      <path v-if="secondary?.length && !sparse" class="trend-line-2" :d="line2Path" />
      <path v-show="!sparse" ref="line" class="trend-line" :d="linePath" />
      <g v-if="sparse" />
      <g v-else-if="showAllDots" class="trend-nodes">
        <circle v-for="(p, i) in shown" :key="i" :cx="p.x" :cy="p.y" r="3.2" />
      </g>
      <g v-else-if="dots && shown.length" class="trend-nodes is-last">
        <circle :cx="shown[shown.length - 1].x" :cy="shown[shown.length - 1].y" r="9" class="trend-halo" />
        <circle :cx="shown[shown.length - 1].x" :cy="shown[shown.length - 1].y" r="3.6" />
      </g>
      <g v-if="hover !== null && target[hover]">
        <line class="trend-cursor" :x1="target[hover].x" :x2="target[hover].x" :y1="PAD.top" :y2="PAD.top + innerH" />
        <line class="trend-cursor is-h" :x1="PAD.left" :x2="width - PAD.right" :y1="target[hover].y" :y2="target[hover].y" />
        <circle class="trend-dot" :cx="target[hover].x" :cy="target[hover].y" r="4.5" />
      </g>
    </svg>
    <div v-if="hover !== null && target[hover]" ref="tip" class="trend-tip m-float">
      <span class="eyebrow">{{ labels[hover] }}</span>
      <span class="trend-tip-row"><i class="tip-key is-primary" />{{ primaryLabel }}<b class="tnum">{{ values[hover] }}{{ unit }}</b></span>
      <span v-if="secondary?.length" class="trend-tip-row"><i class="tip-key is-secondary" />{{ secondaryLabel }}<b class="tnum">{{ secondary[hover] }}{{ unit }}</b></span>
    </div>
  </div>
</template>
