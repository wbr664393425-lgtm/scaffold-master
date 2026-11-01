<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { usePopover } from '@/composables/popover'
import { overlayEnter, overlayLeave } from '@/composables/motion'

/* 行操作容器：常用动作直接铺文字按钮，低频或危险动作收进「更多」下拉。
   面板 Teleport 到 body，表格横向滚动或 overflow 裁剪都盖不住它。 */
withDefaults(defineProps<{
  label?: string
  menuWidth?: number
}>(), {
  label: '更多',
  menuWidth: 148,
})

const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const { open, pos, show, hide, onKeydown } = usePopover({ trigger, panel, minWidth: 148 })

async function toggleMenu() {
  if (open.value) {
    hide(true)
    return
  }
  await show()
  panel.value?.querySelector<HTMLElement>('.menu-item')?.focus()
}

/** 选中任意菜单项后收起，动作本身由页面在被点时执行 */
function onPanelClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.menu-item')) hide()
}
</script>

<template>
  <div class="row-actions">
    <slot />
    <button
      v-if="$slots.more"
      ref="trigger"
      type="button"
      class="row-more"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggleMenu()"
      @keydown="onKeydown"
    >
      {{ label }}<Icon name="chevronDown" :size="11" />
    </button>
  </div>

  <Teleport to="body">
    <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
      <div
        v-if="open"
        ref="panel"
        class="menu-pop m-float"
        role="menu"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, minWidth: `${menuWidth}px` }"
        @click="onPanelClick"
        @keydown="onKeydown"
      >
        <slot name="more" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.row-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: none;
  color: var(--ink-soft);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: color .15s ease;
}
.row-more:hover { color: var(--ink); }
</style>
