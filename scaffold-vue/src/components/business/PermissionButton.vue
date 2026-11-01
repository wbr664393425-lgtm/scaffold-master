<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { hasPermission } from '@/directives/permission'

/* 权限按钮：没有权限码时不渲染（而不是禁用），与后端 @RequiresPermission 使用同一套编码。
   传 iconOnly 时渲染为行内图标按钮，label 作为提示与无障碍名称；
   调用方没写 icon 时按 label 取默认图标，避免整个列表的行操作都退化成「更多」的三个点。 */
const props = withDefaults(defineProps<{
  perm?: string | string[]
  variant?: 'primary' | 'secondary' | 'ghost' | 'text' | 'danger'
  icon?: string
  label?: string
  iconOnly?: boolean
  danger?: boolean
  size?: 'md' | 'sm'
  loading?: boolean
  disabled?: boolean
}>(), {
  variant: 'secondary',
  size: 'md',
})

const LABEL_ICONS: Record<string, string> = {
  详情: 'eye',
  查看详情: 'eye',
  编辑: 'edit',
  删除: 'trash',
  审核: 'check',
  拒绝: 'ban',
  重试: 'refresh',
}

const allowed = computed(() => hasPermission(props.perm))
const iconName = computed(() => props.icon ?? LABEL_ICONS[props.label ?? ''] ?? 'more')
</script>

<template>
  <IconButton v-if="allowed && iconOnly" :name="iconName" :label="label ?? ''" :danger="danger" :disabled="disabled" small />
  <Button v-else-if="allowed" :variant="variant" :icon="icon" :size="size" :danger="danger" :loading="loading" :disabled="disabled"><slot>{{ label }}</slot></Button>
</template>
