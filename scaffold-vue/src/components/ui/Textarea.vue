<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'

/* 多行文本：与 TextInput 同一套外壳（.input-shell.is-multiline），用于备注 / 审核意见 / 协查说明。
   TextInput 的 multiline 只到「能输入」，这里补上字数反馈与 maxlength 约束。 */

export interface TextareaProps {
  modelValue?: string | null
  placeholder?: string
  rows?: number
  maxlength?: number
  /** 显示字数（配合 maxlength 使用） */
  showCount?: boolean
  clearable?: boolean
  disabled?: boolean
  readonly?: boolean
  invalid?: boolean
  autocomplete?: string
}

const props = withDefaults(defineProps<TextareaProps>(), {
  rows: 3,
  showCount: false,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const el = ref<HTMLTextAreaElement | null>(null)
const text = computed(() => props.modelValue ?? '')
const count = computed(() => Array.from(text.value).length)
const reached = computed(() => props.maxlength !== undefined && count.value >= props.maxlength)

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <span class="textarea-wrap">
    <span :class="['input-shell', 'is-multiline', invalid && 'is-invalid', disabled && 'is-disabled']">
      <textarea
        ref="el"
        :value="text"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :rows="rows"
        :maxlength="maxlength"
        :autocomplete="autocomplete"
        :aria-invalid="invalid || undefined"
        @input="onInput"
      />
      <button
        v-if="clearable && text && !disabled && !readonly"
        type="button"
        class="input-clear textarea-clear"
        aria-label="清空"
        @click="emit('update:modelValue', '')"
      ><Icon name="x" :size="14" /></button>
    </span>
    <span v-if="showCount" :class="['textarea-count', 'tnum', reached && 'is-reached']" aria-live="polite">
      {{ count }}<template v-if="maxlength"> / {{ maxlength }}</template>
    </span>
  </span>
</template>

<style scoped>
.textarea-wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.textarea-clear { align-self: flex-start; margin-top: 4px; }
.textarea-count { font-size: 11.5px; color: var(--ink-faint); text-align: right; font-variant-numeric: tabular-nums; }
.textarea-count.is-reached { color: var(--red-text); }
</style>
