<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Checkbox from './Checkbox.vue'
import EmptyState from './EmptyState.vue'
import { revealRows } from '@/composables/motion'

export interface Column {
  key: string
  title: string
  width?: number
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  className?: string
}

const props = withDefaults(defineProps<{
  columns: Column[]
  data: Row[]
  rowKey?: string
  selectable?: boolean
  selected?: (string | number)[]
  loading?: boolean
  emptyText?: string
  /** 树形表格：按 children 展开，首列带缩进与展开按钮 */
  tree?: boolean
  /** 树形表格默认展开到第几层（0 = 全部收起） */
  expandDepth?: number
  minWidth?: number
}>(), {
  rowKey: 'id',
  selected: () => [],
  emptyText: '暂无数据',
  expandDepth: 1,
})

const emit = defineEmits<{
  (e: 'update:selected', value: (string | number)[]): void
  (e: 'row-click', row: Row): void
}>()

const body = ref<HTMLElement | null>(null)
const wrap = ref<HTMLElement | null>(null)
const expanded = ref(new Set<string | number>())

/* 横向溢出只保留滚动能力、不画滚动条；滚动后用阴影提示左侧勾选列已吸附 */
const scrolledX = ref(false)
let resizeObserver: ResizeObserver | null = null

function syncScrollState() {
  scrolledX.value = (wrap.value?.scrollLeft ?? 0) > 1
}

onMounted(() => {
  syncScrollState()
  resizeObserver = new ResizeObserver(() => syncScrollState())
  if (wrap.value) resizeObserver.observe(wrap.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())

interface FlatRow { row: Row; depth: number; hasChildren: boolean }

const flatRows = computed<FlatRow[]>(() => {
  if (!props.tree) return props.data.map(row => ({ row, depth: 0, hasChildren: false }))
  const list: FlatRow[] = []
  const walk = (rows: Row[], depth: number) => rows.forEach(row => {
    const children = (row.children ?? []) as Row[]
    list.push({ row, depth, hasChildren: children.length > 0 })
    if (children.length && expanded.value.has(row[props.rowKey])) walk(children, depth + 1)
  })
  walk(props.data, 0)
  return list
})

const keys = computed(() => flatRows.value.map(item => item.row[props.rowKey]))
const allChecked = computed(() => keys.value.length > 0 && keys.value.every(k => props.selected.includes(k)))
const someChecked = computed(() => !allChecked.value && keys.value.some(k => props.selected.includes(k)))
const colspan = computed(() => props.columns.length + (props.selectable ? 1 : 0))

function toggleAll() {
  emit('update:selected', allChecked.value ? [] : [...keys.value])
}

function toggleRow(key: string | number) {
  emit('update:selected', props.selected.includes(key)
    ? props.selected.filter(k => k !== key)
    : [...props.selected, key])
}

function toggleExpand(key: string | number) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function collectKeys(rows: Row[], depthLimit: number, depth = 0, acc = new Set<string | number>()) {
  rows.forEach(row => {
    const children = (row.children ?? []) as Row[]
    if (children.length && depth < depthLimit) {
      acc.add(row[props.rowKey])
      collectKeys(children, depthLimit, depth + 1, acc)
    }
  })
  return acc
}

function expandAll() { expanded.value = collectKeys(props.data, Infinity) }
function collapseAll() { expanded.value = new Set() }

let initialized = false
let lastSignature = ''
watch(() => props.data, (rows) => {
  if (props.tree && !initialized && rows.length) {
    expanded.value = collectKeys(rows, props.expandDepth)
    initialized = true
  }
  // 换了一批数据才按阅读序显现；原地修改（如切换开关）不重播
  const signature = rows.map(row => row[props.rowKey]).join(',')
  if (signature === lastSignature) return
  lastSignature = signature
  nextTick(() => {
    if (body.value) revealRows(body.value.querySelectorAll('tr.data-row'))
    syncScrollState()
  })
}, { immediate: true })

function cellStyle(col: Column) {
  return {
    width: col.width ? `${col.width}px` : undefined,
    minWidth: col.minWidth ? `${col.minWidth}px` : undefined,
    textAlign: col.align,
  }
}

defineExpose({ expandAll, collapseAll })
</script>

<template>
  <div :class="['table-shell', scrolledX && 'is-hx-scrolled']">
    <div ref="wrap" class="table-wrap" @scroll.passive="syncScrollState">
      <table class="table" :style="minWidth ? { minWidth: `${minWidth}px` } : undefined" :aria-busy="loading">
        <thead>
          <tr>
            <th v-if="selectable" class="col-check">
              <Checkbox :model-value="allChecked" :indeterminate="someChecked" label="" @update:model-value="toggleAll" />
            </th>
            <th v-for="col in columns" :key="col.key" :class="col.className" :style="cellStyle(col)" scope="col">
              <span class="th-inner">{{ col.title }}</span>
            </th>
          </tr>
        </thead>
        <tbody ref="body">
          <template v-if="loading && !data.length">
            <tr v-for="i in 6" :key="`sk${i}`">
              <td v-if="selectable" class="col-check"><span class="skeleton" style="width: 17px; height: 17px; border-radius: 5px" /></td>
              <td v-for="(col, ci) in columns" :key="col.key">
                <span class="skeleton" :style="{ width: `${36 + ((i * 7 + ci * 13) % 48)}%` }" />
              </td>
            </tr>
          </template>
          <tr v-else-if="!flatRows.length">
            <td :colspan="colspan" style="height: auto"><EmptyState :title="emptyText" /></td>
          </tr>
          <template v-else>
            <tr
              v-for="item in flatRows"
              :key="item.row[rowKey]"
              :class="['data-row', selected.includes(item.row[rowKey]) && 'is-selected']"
              :style="loading ? { opacity: .55 } : undefined"
              @click="emit('row-click', item.row)"
            >
              <td v-if="selectable" class="col-check">
                <Checkbox :model-value="selected.includes(item.row[rowKey])" @update:model-value="toggleRow(item.row[rowKey])" />
              </td>
              <td v-for="(col, ci) in columns" :key="col.key" :class="col.className" :style="{ textAlign: col.align }">
                <span v-if="tree && ci === 0" class="tree-cell" :style="{ paddingLeft: `${item.depth * 20}px` }">
                  <button
                    type="button"
                    :class="['tree-toggle', !item.hasChildren && 'is-leaf', expanded.has(item.row[rowKey]) && 'is-open']"
                    :aria-label="expanded.has(item.row[rowKey]) ? '收起' : '展开'"
                    :aria-expanded="item.hasChildren ? expanded.has(item.row[rowKey]) : undefined"
                    :tabindex="item.hasChildren ? 0 : -1"
                    @click.stop="toggleExpand(item.row[rowKey])"
                  ><Icon name="chevronRight" :size="14" /></button>
                  <slot :name="`cell-${col.key}`" :row="item.row" :depth="item.depth">{{ item.row[col.key] }}</slot>
                </span>
                <slot v-else-if="$slots[`cell-${col.key}`]" :name="`cell-${col.key}`" :row="item.row" :depth="item.depth" />
                <span v-else class="cell-text" :title="String(item.row[col.key] ?? '')">{{ item.row[col.key] ?? '—' }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.table-shell {
  min-width: 0;
}
/* 横向溢出只保留滚动能力，不画滚动条：触控板横扫、Shift + 滚轮、触屏拖动照常生效 */
.table-wrap {
  scrollbar-width: none;
}
.table-wrap::-webkit-scrollbar {
  display: none;
}
</style>
