<script setup lang="ts">
import { onMounted, ref, useSlots } from 'vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Panel from '@/components/ui/Panel.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Button from '@/components/ui/Button.vue'
import SearchForm from './SearchForm.vue'
import type { ListPageState } from '@/composables/list'
import { floatBarEnter, floatBarLeave, revealPage } from '@/composables/motion'

/* ============================================================
   统一列表页：页面头 → 查询区 → 表格面板（刷新 / 导出 / 批量条）→ 分页。
   页面只提供：list（useListPage 返回值）、columns、查询字段与单元格插槽。
   单元格插槽 cell-<key> 原样转发给 DataTable。
   ============================================================ */
const props = withDefaults(defineProps<{
  title: string
  desc?: string
  list: ListPageState
  columns: Column[]
  tableTitle?: string
  selectable?: boolean
  rowKey?: string
  minWidth?: number
  /** 为 true 时用 #alt 插槽（画布、看板、矩阵等版式）替换查询区与表格 */
  altView?: boolean
}>(), {
  tableTitle: '数据列表',
  rowKey: 'id',
})

const slots = useSlots()
const isTree = 'tree' in props.list
const root = ref<HTMLElement | null>(null)
const table = ref<{ expandAll: () => void; collapseAll: () => void } | null>(null)
const cellSlots = Object.keys(slots).filter(name => name.startsWith('cell-'))

// 带弹窗兄弟节点的页面在 <Transition> 里是片段根，进场钩子不会触发，这里自己完成显现
onMounted(() => revealPage(root.value))

function clearSelection() {
  props.list.selected.value = []
}
</script>

<template>
  <div ref="root" class="page">
    <PageHeader :title="title" :desc="desc">
      <template v-if="$slots.spec" #spec><slot name="spec" /></template>
      <slot name="actions" />
    </PageHeader>

    <!-- 页头下方的整宽内容（视图切换、概览横带等） -->
    <slot name="before" />

    <div v-if="altView" class="alt-view reveal"><slot name="alt" /></div>
    <div v-else :class="$slots.side ? 'split' : undefined">
      <aside v-if="$slots.side" class="split-side m-surface reveal"><slot name="side" /></aside>
      <div class="stack">
        <SearchForm v-if="$slots.search" :loading="list.loading.value" @search="list.search()" @reset="list.reset()">
          <slot name="search" :query="list.query" />
        </SearchForm>

        <Panel class="reveal" :title="tableTitle" :meta="`共 ${list.total.value} 条`">
          <template #tools>
            <slot name="tools" />
            <template v-if="isTree">
              <IconButton name="chevronDown" label="全部展开" bordered @click="table?.expandAll()" />
              <IconButton name="chevronRight" label="全部收起" bordered @click="table?.collapseAll()" />
            </template>
            <IconButton name="refresh" label="刷新" bordered @click="list.load()" />
            <IconButton v-if="list.canExport" name="download" label="导出当前查询结果" bordered :disabled="list.exporting.value" @click="list.exportData()" />
          </template>


          <DataTable
            ref="table"
            v-model:selected="list.selected.value"
            :columns="columns"
            :data="list.rows.value"
            :loading="list.loading.value"
            :selectable="selectable"
            :row-key="rowKey"
            :min-width="minWidth"
            :tree="isTree"
          >
            <template v-for="name in cellSlots" :key="name" #[name]="scope">
              <slot :name="name" v-bind="scope" />
            </template>
          </DataTable>

          <Pagination
            v-if="!isTree"
            :total="list.total.value"
            :page="list.page.value"
            :page-size="list.pageSize.value"
            @update:page="list.setPage($event)"
            @update:page-size="list.setPageSize($event)"
          />
        </Panel>
      </div>
    </div>

    <!-- 批量操作浮条：勾选后从底部升起（放 Discharge），#batch 插槽 API 不变 -->
    <Teleport to="body">
      <Transition :css="false" @enter="floatBarEnter" @leave="floatBarLeave">
        <div v-if="selectable && list.selected.value.length" class="float-bar" role="region" aria-label="批量操作">
          <span class="float-bar-count">已选 <b class="tnum">{{ list.selected.value.length }}</b> 项</span>
          <span class="float-bar-sep" aria-hidden="true" />
          <slot name="batch" :ids="list.selected.value" />
          <Button variant="text" size="sm" class="float-bar-clear" @click="clearSelection">取消选择</Button>
        </div>
      </Transition>
    </Teleport>

    <slot />
  </div>
</template>
