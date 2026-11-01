<script setup lang="ts">
import { computed, provide } from 'vue'

/* 只读键值汇总：替代 el-descriptions（详情弹窗 / 抽屉里的字段台账）。
   复用 components.css 的 .kv-grid / .kv / .kv-label / .kv-value，与操作日志抽屉同一套材质。 */

export interface DescriptionsProps {
  title?: string
  /** 每行列数 */
  column?: 1 | 2 | 3 | 4
  /** 是否带分隔线（默认带，与 .kv-grid 一致） */
  border?: boolean
  /** 单元格密度 */
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<DescriptionsProps>(), {
  column: 2,
  border: true,
  size: 'md',
})

const columns = computed(() => Math.min(4, Math.max(1, Number(props.column) || 1)))

provide('@@descriptions', {
  column: () => columns.value,
})
</script>

<template>
  <section class="desc">
    <header v-if="title || $slots.extra" class="desc-head">
      <h2 v-if="title" class="section-label">{{ title }}</h2>
      <div v-if="$slots.extra" class="desc-extra"><slot name="extra" /></div>
    </header>
    <div
      :class="['desc-grid', 'kv-grid', !border && 'is-plain', `is-${size}`]"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    >
      <slot />
    </div>
  </section>
</template>

<style scoped>
.desc { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.desc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.desc-extra { display: inline-flex; align-items: center; gap: 6px; }
/* 无分隔线：槽底透明、留白拉开，读作纯文本对照 */
.desc-grid.is-plain { background: transparent; border-color: transparent; gap: 12px 18px; }
.desc-grid.is-plain .kv { background: transparent; padding: 0; }
.desc-grid.is-sm .kv { padding: 8px 10px; }
.desc-grid.is-lg .kv { padding: 16px 18px; }
</style>
