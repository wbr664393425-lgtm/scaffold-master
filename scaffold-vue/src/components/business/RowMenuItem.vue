<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import { hasPermission } from '@/directives/permission'

/* 「更多」下拉里的动作项：没权限整体不渲染，与 PermissionButton 同一套权限码。 */
const props = withDefaults(defineProps<{
  perm?: string | string[]
  icon?: string
  danger?: boolean
}>(), {
  icon: 'trash',
})

const allowed = computed(() => hasPermission(props.perm))
</script>

<template>
  <button v-if="allowed" type="button" class="menu-item" :class="{ 'is-danger': danger }" role="menuitem">
    <Icon :name="icon" :size="15" />
    <slot />
  </button>
</template>
