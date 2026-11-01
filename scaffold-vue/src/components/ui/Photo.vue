<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import IconButton from './IconButton.vue'
import { overlayEnter, overlayLeave } from '@/composables/motion'
import { createFocusTrap } from '@/composables/focus'

/* 照片读数件：证照、车辆照片一律以图代址。
   空值显示「未上传」；外链过期或跨域被拒时显示失效态，避免把一片破图或一串 URL 甩给使用者。
   点击缩略图进全屏预览，预览自身是一个浮层，Escape 只关它、不连带关掉所在的抽屉。 */
const props = withDefaults(defineProps<{
  src?: string | null
  label?: string
  width?: number
  height?: number
}>(), {
  label: '图片',
  width: 168,
  height: 116,
})

const state = ref<'pending' | 'ok' | 'failed'>(props.src ? 'pending' : 'ok')
watch(() => props.src, (src) => { state.value = src ? 'pending' : 'ok' })

const viewer = ref(false)
const panel = ref<HTMLElement | null>(null)
const trap = createFocusTrap()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && trap.isTop()) {
    event.stopImmediatePropagation()
    viewer.value = false
  }
}

async function openViewer() {
  if (!props.src || state.value === 'failed') return
  viewer.value = true
  document.addEventListener('keydown', onKey)
  await nextTick()
  if (viewer.value) trap.activate(panel.value)
}

watch(viewer, (open) => { if (!open) trap.deactivate() })
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <figure class="photo" :style="{ width: `${width}px` }">
    <div class="photo-frame">
      <button
        v-if="src"
        type="button"
        class="photo-thumb m-groove"
        :style="{ height: `${height}px` }"
        :aria-label="`${label}，点击放大`"
        @click="openViewer"
      >
        <img class="photo-img" :src="src" :alt="label" decoding="async" @load="state = 'ok'" @error="state = 'failed'">
        <span v-if="state === 'pending'" class="photo-hint">加载中…</span>
        <span v-else-if="state === 'failed'" class="photo-hint"><Icon name="alert" :size="14" />照片已失效</span>
        <span v-else class="photo-zoom"><Icon name="fit" :size="12" /></span>
      </button>
      <div v-else class="photo-thumb m-groove is-static" :style="{ height: `${height}px` }">
        <span class="photo-hint"><Icon name="image" :size="15" />未上传</span>
      </div>
      <!-- 悬浮出现的动作由调用方给（如上传件的「替换照片 / 清除」），平时不占版面 -->
      <div v-if="$slots.actions" class="photo-actions"><slot name="actions" /></div>
    </div>
    <figcaption class="photo-label">{{ label }}</figcaption>

    <Teleport to="body">
      <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
        <div v-if="viewer" class="overlay photo-viewer" @mousedown.self="viewer = false">
          <div ref="panel" class="photo-stage" role="dialog" aria-modal="true" :aria-label="`${label} 预览`">
            <img class="photo-large" :src="src ?? ''" :alt="label">
            <div class="photo-stage-bar">
              <span class="photo-stage-name">{{ label }}</span>
              <IconButton name="x" label="关闭预览" @click="viewer = false" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </figure>
</template>

<style scoped>
.photo { display: flex; flex-direction: column; gap: 6px; margin: 0; min-width: 0; }
.photo-frame { position: relative; width: 100%; }
.photo-thumb {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: var(--r-sm);
  cursor: zoom-in;
}
.photo-thumb.is-static { cursor: default; }
.photo-img { display: block; width: 100%; height: 100%; object-fit: cover; }
.photo-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 18px 6px 6px;
  border-radius: 0 0 var(--r-sm) var(--r-sm);
  background: linear-gradient(to top, rgba(16, 20, 24, .62), rgba(16, 20, 24, 0));
  opacity: 0;
  pointer-events: none;
  transition: opacity .16s ease;
}
.photo-frame:hover .photo-actions,
.photo-frame:focus-within .photo-actions { opacity: 1; pointer-events: auto; }
.photo-zoom {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-xs);
  color: var(--ink);
  background: var(--surface-solid);
  opacity: 0;
  transition: opacity .15s ease;
}
.photo-thumb:hover .photo-zoom,
.photo-thumb:focus-visible .photo-zoom { opacity: 1; }
.photo-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-soft);
  background: var(--surface-solid);
}
.photo-label { font-size: 12px; color: var(--ink-soft); }

.photo-viewer { padding: 32px; }
.photo-stage { display: flex; flex-direction: column; gap: 10px; max-width: min(100%, 1040px); min-width: 0; }
.photo-large {
  max-width: 100%;
  max-height: calc(100dvh - 128px);
  border-radius: var(--r-md);
  object-fit: contain;
  background: var(--surface-solid);
  box-shadow: var(--edge), var(--e3);
}
.photo-stage-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.photo-stage-name { font-size: 12.5px; color: var(--ink-muted); }
</style>
