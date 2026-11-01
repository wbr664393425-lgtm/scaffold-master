<script setup lang="ts">
import { computed, inject } from 'vue'

/* Descriptions 的一行 / 一格：label 在上、值在下；span 跨列，width 用作最小宽度约束。 */

export interface DescriptionsItemProps {
  label?: string
  /** 跨几列（受父级 column 上限约束） */
  span?: number
  /** 最小宽度：数字按 px，字符串原样（如 '30%'） */
  width?: number | string
}

const props = withDefaults(defineProps<DescriptionsItemProps>(), { span: 1 })

const parent = inject<{ column: () => number } | null>('@@descriptions', null)

const style = computed(() => {
  const limit = parent?.column() ?? 4
  const span = Math.min(Math.max(1, Math.trunc(props.span ?? 1)), limit)
  return {
    gridColumn: span > 1 ? `span ${span}` : undefined,
    minWidth: typeof props.width === 'number' ? `${props.width}px` : props.width,
  }
})
</script>

<template>
  <div class="kv" :style="style">
    <div v-if="label" class="kv-label">{{ label }}</div>
    <div class="kv-value"><slot /></div>
  </div>
</template>
