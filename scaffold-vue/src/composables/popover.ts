import { nextTick, onBeforeUnmount, ref, type Ref } from 'vue'
import { floatingLayerFor } from './focus'

/* ============================================================
   浮层定位与开关：下拉、日历、树选择共用一套行为。
   - 面板 Teleport 到 body + position: fixed，不受表格 overflow: clip 与卡片裁剪影响
   - 外部点击（pointerdown 捕获）、滚动、缩放、Escape 的处理集中在这里
   - Escape 只关闭当前浮层，不连带关闭所在弹窗
   层级仍取自 focus.ts 的 floatingLayerFor，保证后开的浮层压在上面。
   ============================================================ */

export interface PopoverPos {
  top: number
  left: number
  width: number
}

export interface PopoverOptions {
  trigger: Ref<HTMLElement | null>
  panel: Ref<HTMLElement | null>
  /** 面板最小宽度（触发控件更宽时以触发控件为准） */
  minWidth?: number
  /** 面板与触发控件的间距 */
  gap?: number
  /** 面板宽度是否跟随触发控件；日历这类固定宽面板传 false */
  followTriggerWidth?: boolean
}

export function usePopover(options: PopoverOptions) {
  const gap = options.gap ?? 6
  const minWidth = options.minWidth ?? 0
  const follow = options.followTriggerWidth ?? false

  const open = ref(false)
  const pos = ref<PopoverPos>({ top: 0, left: 0, width: minWidth })

  /** 渲染期取值：每次打开都重新跟随所在浮层层级 */
  function layer() {
    return floatingLayerFor(options.trigger.value)
  }

  function place() {
    const anchor = options.trigger.value
    const panel = options.panel.value
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = panel?.offsetHeight ?? 300
    const width = Math.max(panel?.offsetWidth ?? 0, follow ? rect.width : 0, minWidth)
    const below = window.innerHeight - rect.bottom
    const top = below < height + gap + 12 && rect.top > height + gap + 12 ? rect.top - height - gap : rect.bottom + gap
    const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - width - 8))
    pos.value = { top, left, width: follow ? width : 0 }
  }

  function onOutside(event: PointerEvent) {
    const target = event.target as Node
    if (options.trigger.value?.contains(target) || options.panel.value?.contains(target)) return
    hide()
  }

  async function show() {
    if (open.value) return
    open.value = true
    place()
    await nextTick()
    place()
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
  }

  function hide(refocus = false) {
    if (!open.value) return
    open.value = false
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
    if (refocus) options.trigger.value?.focus({ preventScroll: true })
  }

  function toggle() {
    if (open.value) hide(true)
    else show()
  }

  /** 挂在触发控件与面板的 keydown 上：命中 Escape 时返回 true 并阻止冒泡到弹窗 */
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open.value) {
      event.preventDefault()
      event.stopPropagation()
      hide(true)
      return true
    }
    return false
  }

  onBeforeUnmount(() => hide())

  return { open, pos, show, hide, toggle, place, layer, onKeydown }
}
