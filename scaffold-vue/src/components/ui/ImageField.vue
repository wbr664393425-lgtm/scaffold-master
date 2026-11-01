<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Photo from './Photo.vue'
import Upload from './Upload.vue'
import { pushToast } from '@/composables/toast'

/* 图片表单件：v-model 存地址，界面上只看照片。
   动作（上传 / 替换 / 清除）压在悬浮层里，不额外占一行；选文件与鉴权仍交给 Upload。 */
const props = withDefaults(defineProps<{
  modelValue?: string | null
  label?: string
  action?: string
  accept?: string
  width?: number
  height?: number
}>(), {
  modelValue: '',
  label: '照片',
  action: '/common/upload',
  accept: '.png,.jpg,.jpeg,.webp',
  width: 168,
  height: 116,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const uploader = ref<InstanceType<typeof Upload> | null>(null)

function onUploaded(response: unknown) {
  const record = response as { url?: string; fileName?: string } | null
  const url = record?.url || record?.fileName
  if (!url) {
    pushToast('上传成功但未返回图片地址', 'danger')
    return
  }
  emit('update:modelValue', url)
  // 清掉本次记录，否则 maxCount=1 会挡住下一次「替换照片」
  uploader.value?.clear()
}
</script>

<template>
  <div class="image-field">
    <Photo :src="modelValue" :label="label" :width="width" :height="height">
      <template #actions>
        <button type="button" class="image-action" @click="uploader?.pickFile()">
          <Icon :name="modelValue ? 'refresh' : 'upload'" :size="13" />{{ modelValue ? '替换照片' : '上传照片' }}
        </button>
        <button v-if="modelValue" type="button" class="image-action" @click="emit('update:modelValue', '')">
          <Icon name="trash" :size="13" />清除
        </button>
      </template>
    </Photo>

    <span class="image-uploader">
      <Upload
        ref="uploader"
        :action="action"
        :accept="accept"
        :max-count="1"
        :max-size-mb="5"
        :show-trigger="false"
        @success="onUploaded"
      />
    </span>
  </div>
</template>

<style scoped>
.image-field { position: relative; display: inline-flex; min-width: 0; }
/* Upload 只负责选文件与上传，触发按钮由悬浮层自己画 */
.image-uploader { display: none; }
.image-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--r-xs);
  background: rgba(251, 252, 252, .18);
  color: #fbfcfc;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background .15s ease;
}
.image-action:hover { background: rgba(251, 252, 252, .3); }
</style>
