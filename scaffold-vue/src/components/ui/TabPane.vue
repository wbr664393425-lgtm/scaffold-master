<script setup lang="ts">
import { computed, getCurrentInstance, inject, onBeforeUnmount, watch } from 'vue'
import type { TabPaneRecord } from './Tabs.vue'

/* 选项卡的一页：由 Tabs 收集标签并托管显隐。
   脱离 Tabs 单独使用时等价于一个普通容器。 */

export interface TabPaneProps {
  label: string
  /** 面板标识，与 Tabs 的 v-model 对应 */
  name: string
  disabled?: boolean
  /** 首次激活才渲染内容 */
  lazy?: boolean
  badge?: string | number
}

interface TabsContext {
  register: (pane: TabPaneRecord) => void
  update: (uid: number, patch: Partial<TabPaneRecord>) => void
  unregister: (uid: number) => void
  isActive: (value: string) => boolean
  shouldRender: (value: string, lazy: boolean | undefined) => boolean
}

const props = defineProps<TabPaneProps>()

const tabs = inject<TabsContext | null>('@@tabs', null)
// uid 取组件实例自带的全局唯一号：注册去重与卸载都按它对齐
const uid = getCurrentInstance()?.uid ?? 0
if (tabs) {
  tabs.register({ uid, value: props.name, label: props.label, disabled: Boolean(props.disabled), badge: props.badge })
  watch(() => [props.label, props.name, props.disabled, props.badge] as const, ([label, value, disabled, badge]) => {
    tabs.update(uid, { label, value, disabled: Boolean(disabled), badge })
  })
  onBeforeUnmount(() => tabs.unregister(uid))
}

const active = computed(() => (tabs ? tabs.isActive(props.name) : true))
const rendered = computed(() => (tabs ? tabs.shouldRender(props.name, props.lazy) : true))
</script>

<template>
  <div
    v-if="rendered"
    v-show="active"
    class="tab-pane"
    role="tabpanel"
    :id="`panel-${props.name}`"
    :aria-labelledby="`tab-${props.name}`"
    tabindex="0"
  ><slot /></div>
</template>

<style scoped>
.tab-pane { min-width: 0; }
.tab-pane:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; border-radius: var(--r-xs); }
</style>
