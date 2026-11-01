<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Checkbox from './Checkbox.vue'
import TextInput from './TextInput.vue'
import { overlayEnter, overlayLeave } from '@/composables/motion'
import { usePopover } from '@/composables/popover'

/* ============================================================
   树形选择：DeptSelect / DeptTree 的数据驱动版（车辆品牌→车型、菜单权限都用它）。
   - 单选：点节点即选中并收起；再点同一节点取消
   - 多选：节点带勾选框；checkStrictly=false 时勾选父级连带全部下级
   - 取值只认 id，不用 Date / 对象
   ============================================================ */

export interface TreeNode {
  id: number | string
  label: string
  children?: TreeNode[]
  disabled?: boolean
  /** 附加说明，显示在标签右侧 */
  hint?: string
}

export type TreeValue = number | string | (number | string)[] | null

export interface TreeSelectProps {
  modelValue: TreeValue
  data: TreeNode[]
  multiple?: boolean
  /** 父子不关联：勾父只记父（菜单权限回显常用） */
  checkStrictly?: boolean
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  invalid?: boolean
  filterable?: boolean
  /** 默认展开到第几层（0 = 全部收起） */
  expandDepth?: number
  /** 多选时最多展示几个标签，其余折算为「+N」 */
  maxTagCount?: number
}

const props = withDefaults(defineProps<TreeSelectProps>(), {
  placeholder: '请选择',
  clearable: true,
  filterable: true,
  expandDepth: 1,
  maxTagCount: 3,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: TreeValue): void }>()

const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const search = ref<InstanceType<typeof TextInput> | null>(null)
const keyword = ref('')
const activeIndex = ref(-1)
const expanded = ref(new Set<number | string>())
const pop = usePopover({ trigger, panel, minWidth: 220, followTriggerWidth: true })
const listId = `ts-${Math.random().toString(36).slice(2, 8)}`

const selected = computed<Set<number | string>>(() => {
  const value = props.modelValue
  if (value === null || value === undefined) return new Set()
  return new Set(Array.isArray(value) ? value : [value])
})

interface Row {
  node: TreeNode
  depth: number
  hasChildren: boolean
  open: boolean
}

const parentOf = computed(() => {
  const map = new Map<number | string, number | string>()
  const walk = (nodes: TreeNode[], parent?: number | string) => nodes.forEach((node) => {
    if (parent !== undefined) map.set(node.id, parent)
    walk(node.children ?? [], node.id)
  })
  walk(props.data)
  return map
})

function matches(node: TreeNode): boolean {
  const key = keyword.value.trim().toLowerCase()
  if (!key) return true
  if (node.label.toLowerCase().includes(key)) return true
  return (node.children ?? []).some(matches)
}

const rows = computed<Row[]>(() => {
  const list: Row[] = []
  const searching = Boolean(keyword.value.trim())
  const walk = (nodes: TreeNode[], depth: number) => nodes.filter(matches).forEach((node) => {
    const children = node.children ?? []
    const open = searching || expanded.value.has(node.id)
    list.push({ node, depth, hasChildren: children.length > 0, open })
    if (open) walk(children, depth + 1)
  })
  walk(props.data, 0)
  return list
})

const labels = computed(() => {
  const index = new Map<number | string, string>()
  const walk = (nodes: TreeNode[]) => nodes.forEach(node => {
    index.set(node.id, node.label)
    walk(node.children ?? [])
  })
  walk(props.data)
  return index
})

const shownLabels = computed(() => [...selected.value].map(id => labels.value.get(id) ?? String(id)))

/** 单个节点的下级全部 id（含自身） */
function subtreeIds(node: TreeNode): (number | string)[] {
  return [node.id, ...(node.children ?? []).flatMap(subtreeIds)]
}

/** 节点勾选态：非严格模式下由下级聚合出来 */
function nodeState(node: TreeNode): { on: boolean; some: boolean } {
  if (props.checkStrictly || !node.children?.length) return { on: selected.value.has(node.id), some: false }
  const ids = subtreeIds(node)
  const on = ids.filter(id => selected.value.has(id)).length
  return { on: on === ids.length, some: on > 0 && on < ids.length }
}

function collectKeys(nodes: TreeNode[], depthLimit: number, depth = 0, acc = new Set<number | string>()) {
  nodes.forEach(node => {
    if (node.children?.length && depth < depthLimit) {
      acc.add(node.id)
      collectKeys(node.children, depthLimit, depth + 1, acc)
    }
  })
  return acc
}

async function open() {
  if (props.disabled) return
  keyword.value = ''
  if (!expanded.value.size) expanded.value = collectKeys(props.data, props.expandDepth)
  pop.show()
  activeIndex.value = Math.max(0, rows.value.findIndex(row => selected.value.has(row.node.id)))
  await nextTick()
  if (props.filterable) search.value?.focus()
}

function clear() {
  emit('update:modelValue', props.multiple ? [] : null)
  pop.hide(true)
}

function toggleExpand(id: number | string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function pickSingle(node: TreeNode) {
  if (node.disabled) return
  emit('update:modelValue', props.modelValue === node.id ? null : node.id)
  pop.hide(true)
}

function toggleMultiple(node: TreeNode) {
  if (node.disabled) return
  const next = new Set(selected.value)
  const ids = subtreeIds(node)
  if (props.checkStrictly) {
    if (next.has(node.id)) next.delete(node.id)
    else next.add(node.id)
  } else if (nodeState(node).on) {
    // 取消整棵子树，并顺带取消所有祖先
    ids.forEach(id => next.delete(id))
    let parent = parentOf.value.get(node.id)
    while (parent !== undefined) {
      next.delete(parent)
      parent = parentOf.value.get(parent)
    }
  } else {
    ids.forEach(id => next.add(id))
    // 有下级被勾上就必须能进入父级，否则树里会出现孤立分支
    let parent = parentOf.value.get(node.id)
    while (parent !== undefined) {
      next.add(parent)
      parent = parentOf.value.get(parent)
    }
  }
  emit('update:modelValue', [...next])
}

function toggle(row: Row) {
  if (props.multiple) toggleMultiple(row.node)
  else pickSingle(row.node)
}

function move(step: number) {
  const list = rows.value
  if (!list.length) return
  let index = activeIndex.value
  for (let i = 0; i < list.length; i += 1) {
    index = (index + step + list.length) % list.length
    if (!list[index].node.disabled) break
  }
  activeIndex.value = index
  nextTick(() => panel.value?.querySelector('.tree-row.is-active')?.scrollIntoView({ block: 'nearest' }))
}

function onKeydown(event: KeyboardEvent) {
  if (pop.onKeydown(event)) return
  if (!pop.open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      open()
    }
    return
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
  else if (event.key === 'ArrowRight') {
    const row = rows.value[activeIndex.value]
    if (row?.hasChildren && !row.open) { event.preventDefault(); toggleExpand(row.node.id) }
  } else if (event.key === 'ArrowLeft') {
    const row = rows.value[activeIndex.value]
    if (row?.hasChildren && row.open) { event.preventDefault(); toggleExpand(row.node.id) }
  } else if (event.key === 'Enter' || (event.key === ' ' && (event.target as HTMLElement)?.tagName !== 'INPUT')) {
    const row = rows.value[activeIndex.value]
    if (row) { event.preventDefault(); toggle(row) }
  } else if (event.key === 'Tab') pop.hide()
}

watch(keyword, () => { activeIndex.value = rows.value.length ? 0 : -1 })
watch(() => props.multiple, () => pop.hide())

defineExpose({ open, close: () => pop.hide(), clear })
</script>

<template>
  <div
    ref="trigger"
    :class="['input-shell', 'tree-select', invalid && 'is-invalid', disabled && 'is-disabled']"
    role="combobox"
    aria-haspopup="tree"
    :aria-expanded="pop.open.value"
    :aria-controls="listId"
    :aria-invalid="invalid || undefined"
    :aria-disabled="disabled || undefined"
    tabindex="0"
    @click="pop.open.value ? pop.hide(true) : open()"
    @keydown="onKeydown"
  >
    <span class="tree-value" :class="{ 'is-placeholder': !shownLabels.length }">
      <template v-if="shownLabels.length">
        <span
          v-for="(label, i) in shownLabels.slice(0, maxTagCount)"
          :key="`${i}-${label}`"
          class="tree-tag"
        >{{ label }}</span>
        <span v-if="shownLabels.length > maxTagCount" class="tree-tag is-more">+{{ shownLabels.length - maxTagCount }}</span>
      </template>
      <template v-else>{{ placeholder }}</template>
    </span>
    <span
      v-if="clearable && shownLabels.length && !disabled"
      class="input-clear"
      role="button"
      tabindex="-1"
      aria-label="清空"
      @click.stop="clear"
    ><Icon name="x" :size="14" /></span>
    <Icon v-else class="select-caret" name="chevronDown" :size="15" />
  </div>

  <Teleport to="body">
    <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
      <div
        v-if="pop.open.value"
        ref="panel"
        :id="listId"
        class="select-menu tree-menu m-float"
        :style="{ top: `${pop.pos.value.top}px`, left: `${pop.pos.value.left}px`, width: `${pop.pos.value.width}px`, zIndex: pop.layer() }"
        @keydown="onKeydown"
      >
        <div v-if="filterable" class="select-search">
          <TextInput ref="search" v-model="keyword" icon="search" placeholder="搜索" aria-label="搜索选项" />
        </div>
        <div class="tree tree-scroll" role="tree" :aria-label="placeholder" :aria-multiselectable="multiple || undefined">
          <div
            v-for="(row, i) in rows"
            :key="row.node.id"
            role="treeitem"
            :aria-selected="multiple ? nodeState(row.node).on : selected.has(row.node.id)"
            :aria-expanded="row.hasChildren ? row.open : undefined"
            :aria-level="row.depth + 1"
            :aria-disabled="row.node.disabled || undefined"
            :class="['tree-row', i === activeIndex && 'is-active', selected.has(row.node.id) && 'is-selected', row.node.disabled && 'is-disabled']"
            :style="{ paddingLeft: `${4 + row.depth * 16}px` }"
            @pointerenter="activeIndex = i"
            @click="toggle(row)"
          >
            <button
              type="button"
              :class="['tree-toggle', !row.hasChildren && 'is-leaf', row.open && 'is-open']"
              :aria-label="row.open ? '收起' : '展开'"
              tabindex="-1"
              @click.stop="toggleExpand(row.node.id)"
            ><Icon name="chevronRight" :size="13" /></button>
            <Checkbox
              v-if="multiple"
              :model-value="nodeState(row.node).on"
              :indeterminate="nodeState(row.node).some"
              :disabled="row.node.disabled"
              :label="row.node.label"
              @update:model-value="toggle(row)"
              @click.stop
            />
            <span v-else class="tree-label">{{ row.node.label }}</span>
            <span v-if="row.node.hint" class="tree-count">{{ row.node.hint }}</span>
            <Icon v-if="!multiple && selected.has(row.node.id)" name="check" :size="14" />
          </div>
          <div v-if="!rows.length" class="select-empty">无匹配项</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tree-select {
  width: 100%;
  cursor: pointer;
  justify-content: space-between;
  text-align: left;
  color: var(--ink);
  height: auto;
  min-height: var(--control-h);
  padding-block: 3px;
}
.tree-value {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 13px;
}
.tree-value.is-placeholder { color: var(--ink-faint); }
.tree-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  max-width: 140px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-muted);
  background: rgba(var(--shade), .065);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
:root[data-theme="dark"] .tree-tag { background: rgba(255, 255, 255, .07); }
.tree-tag.is-more { color: var(--blue); background: var(--blue-soft); }
.tree-menu { min-width: 220px; max-height: 320px; }
.tree-scroll { overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
.tree-row.is-active { background: var(--hover-bg); }
.tree-row.is-disabled { color: var(--ink-faint); cursor: not-allowed; }
.tree-row :deep(.checkbox) { cursor: inherit; }
</style>
