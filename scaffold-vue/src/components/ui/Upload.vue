<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Button from './Button.vue'
import IconButton from './IconButton.vue'
import { pushToast, toastError } from '@/composables/toast'
import { postUpload, type UploadQuery } from '@/composables/upload'

/* ============================================================
   文件上传：替代 el-upload（证照附件、批量导入文件等场景）。
   传输走 composables/upload.ts 的 fetch + Authorization: Bearer，
   与 api/http.ts 同一套鉴权与 { code, message, data } 信封（兼容 RuoYi 的 msg）。
   fetch 不回报字节进度，上传中用斜线慢操作条（DESIGN.md：斜线只表示区间 / 慢操作）。

   用法一（照片，选完即传）：
     <Upload action="/common/upload" list-type="picture" :max-count="3"
             @success="(data) => form.licenceUrl = data.url" />
   用法二（Excel 导入，先下载模板再选文件、点确定才提交）：
     <Upload ref="importer" action="/business/xxx/importData" accept=".xlsx,.xls"
             :max-count="1" :manual="true" drag @update:file-list="staged = $event">
       <template #tip>
         <Button variant="text" size="sm" icon="download" @click="downloadTemplate">下载模板</Button>
       </template>
     </Upload>
     // 下载模板走统一下载能力：await systemApi.xxx.importTemplate() → downloadBlob(blob, '模板.xlsx')
     // 提交导入：await importer.value.submit()   （staged 为空时给出提示）
   ============================================================ */

export type UploadStatus = 'staged' | 'uploading' | 'done' | 'error'

export interface UploadFileItem {
  uid: number
  name: string
  size: number
  status: UploadStatus
  /** 上传成功后的服务端返回（信封里的 data） */
  response?: unknown
  /** 可预览地址：后端返回的 url / fileName */
  url?: string
  /** 失败原因（后端 message 优先） */
  message?: string
}

interface TrackedFile extends UploadFileItem {
  preview?: string
}

export interface UploadProps {
  /** 上传地址（相对 VITE_API_BASE_URL，如 /common/upload、/业务模块/importData） */
  action: string
  /** 随文件提交的表单字段 */
  data?: Record<string, unknown>
  /** 拼在 URL 上的查询参数（RuoYi 的 ?updateSupport=0 走这里） */
  query?: UploadQuery
  /** 文件字段名，后端默认读 file */
  name?: string
  accept?: string
  multiple?: boolean
  maxCount?: number
  maxSizeMb?: number
  listType?: 'text' | 'picture'
  disabled?: boolean
  /** 拖拽区（Excel 导入常用） */
  drag?: boolean
  /** 选完不自动上传，等页面调 submit() */
  manual?: boolean
  buttonText?: string
  tip?: string
  /** 隐藏自带触发按钮：页面自己画按钮时调 pickFile()（ImageField 的悬浮层用这种） */
  showTrigger?: boolean
}

const props = withDefaults(defineProps<UploadProps>(), {
  name: 'file',
  listType: 'text',
  maxCount: 1,
  buttonText: '选择文件',
  showTrigger: true,
})

const emit = defineEmits<{
  (e: 'success', response: unknown, file: UploadFileItem): void
  (e: 'error', error: unknown, file: UploadFileItem): void
  (e: 'update:fileList', files: UploadFileItem[]): void
}>()

const input = ref<HTMLInputElement | null>(null)
const files = ref<TrackedFile[]>([])
const dragging = ref(false)
let seed = 0
/** 原始 File 不进响应式代理（Proxy 会让 FormData.append 报错），按 uid 另存 */
const raws = new Map<number, File>()

const count = computed(() => files.value.length)
const overLimit = computed(() => count.value >= props.maxCount)
const busy = computed(() => files.value.some(f => f.status === 'uploading'))

function publicItem(file: TrackedFile): UploadFileItem {
  const { preview: _preview, ...rest } = file
  return rest
}

function sync() {
  emit('update:fileList', files.value.map(publicItem))
}

/** accept 校验：支持 .xlsx 与 image/* 两种写法 */
function accepted(file: File) {
  if (!props.accept) return true
  return props.accept.split(',').some((rule) => {
    const token = rule.trim().toLowerCase()
    if (!token) return false
    if (token.startsWith('.')) return file.name.toLowerCase().endsWith(token)
    if (token.endsWith('/*')) return file.type.toLowerCase().startsWith(token.slice(0, -1))
    return file.type.toLowerCase() === token
  })
}

function pickUrl(response: unknown): string | undefined {
  if (typeof response === 'string') return response.startsWith('http') || response.startsWith('/') ? response : undefined
  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>
    const value = record.url ?? record.fileName ?? record.imgUrl ?? record.filePath
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function addFiles(list: FileList | File[]) {
  if (props.disabled || busy.value) return
  const incoming = Array.from(list)
  let rejected = 0
  for (const raw of incoming) {
    if (!accepted(raw)) {
      pushToast(`「${raw.name}」不是允许的文件格式（${props.accept}）`, 'danger')
      rejected += 1
      continue
    }
    if (props.maxSizeMb && raw.size > props.maxSizeMb * 1024 * 1024) {
      pushToast(`「${raw.name}」超过 ${props.maxSizeMb}MB`, 'danger')
      rejected += 1
      continue
    }
    if (count.value + 1 > props.maxCount) {
      pushToast(`最多上传 ${props.maxCount} 个文件`, 'danger')
      break
    }
    const uid = ++seed
    raws.set(uid, raw)
    const file: TrackedFile = {
      uid,
      name: raw.name,
      size: raw.size,
      status: props.manual ? 'staged' : 'uploading',
      preview: props.listType === 'picture' ? URL.createObjectURL(raw) : undefined,
    }
    files.value.push(file)
    sync()
    if (!props.manual) await send(file)
  }
  if (rejected) sync()
}

async function send(file: TrackedFile) {
  const target = files.value.find(item => item.uid === file.uid)
  if (!target) return
  target.status = 'uploading'
  target.message = undefined
  try {
    const raw = raws.get(target.uid)
    if (!raw) {
      target.status = 'error'
      target.message = '文件已失效，请重新选择'
      return
    }
    const response = await postUpload(props.action, raw, {
      field: props.name,
      data: props.data,
      query: props.query,
    })
    target.status = 'done'
    target.response = response
    target.url = pickUrl(response)
    if (target.preview && target.url) {
      // 服务端地址到手后就换用它，本地 blob 及时释放
      URL.revokeObjectURL(target.preview)
      target.preview = undefined
    }
    emit('success', response, publicItem(target))
    pushToast(`${target.name} 上传完成`, 'ok')
  } catch (error) {
    target.status = 'error'
    target.message = error instanceof Error && error.message ? error.message : '上传失败'
    emit('error', error, publicItem(target))
    toastError(error, `${target.name} 上传失败`)
  } finally {
    sync()
  }
}

/** 提交所有待上传（manual 模式给「确定」按钮用）；返回是否全部成功 */
async function submit() {
  const pending = files.value.filter(f => f.status === 'staged' || f.status === 'error')
  if (!pending.length) {
    pushToast('请先选择文件', 'info')
    return false
  }
  await Promise.all(pending.map(send))
  return files.value.every(f => f.status === 'done')
}

function remove(uid: number) {
  const index = files.value.findIndex(f => f.uid === uid)
  if (index === -1) return
  const [gone] = files.value.splice(index, 1)
  if (gone?.preview) URL.revokeObjectURL(gone.preview)
  raws.delete(uid)
  sync()
}

function clear() {
  files.value.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
  files.value = []
  raws.clear()
  sync()
}

function pickFile() {
  if (props.disabled || overLimit.value && !props.multiple) return
  input.value?.click()
}

function onDrop(event: DragEvent) {
  dragging.value = false
  if (props.disabled) return
  const list = event.dataTransfer?.files
  if (list?.length) addFiles(list)
}

onBeforeUnmount(() => {
  files.value.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
  raws.clear()
})

defineExpose({ pickFile, submit, clear, remove, files: () => files.value.map(publicItem) })
</script>

<template>
  <div :class="['upload', `is-${listType}`, disabled && 'is-disabled']">
    <input
      ref="input"
      class="sr-only"
      type="file"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      @change="addFiles(($event.target as HTMLInputElement).files ?? []); ($event.target as HTMLInputElement).value = ''"
    >

    <div v-if="drag"
         :class="['upload-zone', 'm-groove', dragging && 'is-dragging']"
         role="button"
         tabindex="0"
         :aria-disabled="disabled || undefined"
         aria-label="选择或拖入文件"
         @click="pickFile"
         @keydown.enter.prevent="pickFile"
         @keydown.space.prevent="pickFile"
         @dragover.prevent="dragging = !disabled"
         @dragleave="dragging = false"
         @drop.prevent="onDrop"
    >
      <Icon name="upload" :size="22" />
      <span class="upload-zone-text">将文件拖到此处，或<em>点击选择</em></span>
    </div>
    <Button v-else-if="showTrigger" variant="secondary" icon="upload" :disabled="disabled || (maxCount > 1 && overLimit)" @click="pickFile">{{ buttonText }}</Button>

    <ul v-if="files.length" class="upload-list m-groove" aria-label="文件列表">
      <li v-for="f in files" :key="f.uid" :class="['upload-row', f.status !== 'done' && `is-${f.status}`]">
        <template v-if="listType === 'picture'">
          <img class="upload-thumb" :src="f.preview ?? f.url ?? ''" :alt="f.name">
        </template>
        <Icon v-else class="upload-ico" :name="f.status === 'done' ? 'file' : 'upload'" :size="16" />
        <span class="upload-meta">
          <span class="upload-name ellipsis" :title="f.name">{{ f.name }}</span>
          <span class="upload-sub">
            <span class="tnum">{{ formatSize(f.size) }}</span>
            <span v-if="f.status === 'uploading'" class="upload-state">上传中…</span>
            <span v-else-if="f.status === 'staged'" class="upload-state">待提交</span>
            <span v-else-if="f.status === 'error'" class="upload-state is-failed" role="alert">{{ f.message ?? '上传失败' }}</span>
            <span v-else class="upload-state is-ok">已上传</span>
          </span>
          <span v-if="f.status === 'uploading'" class="upload-bar" aria-hidden="true" />
        </span>
        <IconButton v-if="f.status === 'error'" name="refresh" label="重新上传" small bordered @click="send(f)" />
        <IconButton v-if="f.status !== 'uploading'" name="trash" label="移除" small danger bordered @click="remove(f.uid)" />
      </li>
    </ul>

    <p v-if="$slots.tip || tip" class="upload-tip">
      <slot name="tip">{{ tip }}</slot>
    </p>
  </div>
</template>

<style scoped>
.upload { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; min-width: 0; width: 100%; }
.upload.is-disabled { opacity: .6; }
.upload.is-picture { align-items: stretch; }

.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 26px 16px;
  border-radius: var(--r-md);
  color: var(--ink-soft);
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease, color .2s ease;
}
.upload-zone:hover, .upload-zone.is-dragging { color: var(--blue); border-color: var(--blue); }
.upload-zone:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.upload-zone-text { font-size: 13px; }
.upload-zone-text em { font-style: normal; color: var(--blue); font-weight: 620; }

.upload-list { list-style: none; margin: 0; padding: 4px; width: 100%; display: flex; flex-direction: column; gap: 2px; }
.upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--surface-solid);
  transition: background .15s ease;
}
.upload-row.is-error { box-shadow: inset 0 0 0 1px var(--red-soft); }
.upload-ico { color: var(--ink-soft); flex: none; }
.upload-thumb { width: 42px; height: 42px; border-radius: var(--r-xs); object-fit: cover; flex: none; background: var(--hover-bg); }
.upload-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; position: relative; }
.upload-name { font-size: 12.5px; font-weight: 600; color: var(--ink); }
.upload-sub { display: inline-flex; gap: 8px; font-size: 11.5px; color: var(--ink-faint); }
.upload-state.is-ok { color: var(--leaf-text); }
.upload-state.is-failed { color: var(--red-text); }
/* 慢操作条：斜线填充表示「正在进行、时长未知」，不编造百分比 */
.upload-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -4px;
  height: 3px;
  border-radius: 999px;
  background: var(--hatch);
  opacity: .9;
}
.upload-tip { font-size: 11.5px; color: var(--ink-soft); line-height: 1.6; }
</style>
