import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(Flip)

/* ============================================================
   动效唯一入口。每条动效都要能说出能量语态：
   蓄 Charge（输入）/ 放 Discharge（开始工作）/ 导 Conduct（进行中）/
   结 Crystallize（交付落定）/ 停摆 Halt（停止、恢复默认）。
   说不出语态的就是装饰，不做。
   ============================================================ */

export const EASE = Object.freeze({
  reveal: 'expo.out',      // 显现
  glide: 'power4.out',     // 位移滑行
  exit: 'power2.in',       // 退场
  swap: 'power2.inOut',    // 双向交接
  settle: 'back.out(1.6)', // 落定确认
})

export const DUR = Object.freeze({
  press: 0.14,
  release: 0.46,
  hoverIn: 0.34,
  hoverOut: 0.42,
  slide: 0.52,
  pageOut: 0.18,
  pageIn: 0.62,
  overlayIn: 0.42,
  overlayOut: 0.2,
})

const reducedQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

export function prefersReducedMotion() {
  return Boolean(reducedQuery?.matches)
}

/** 页面在后台时 rAF 被节流，补间会停在中途：此时直接给终态 */
function skipMotion() {
  return prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden)
}

// 切到后台时把正在进行的补间走完，回到前台不会看到停在半路的弹窗或页面
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return
    gsap.globalTimeline.getChildren(false, true, true).forEach(t => t.progress(1, false))
  })
}

/** 等两帧合成后再起播：避开 backdrop-filter 首次栅格化那一帧 */
export function afterTwoFrames(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

/* ── 按压反馈：事件委托，新控件命中选择器即获得同一手感（放 Discharge） ── */
const PRESSABLE = [
  '.btn', '.icon-btn', '.nav-item', '.segmented button', '.pg-btn',
  '.perm-chip', '.cmd-trigger', '.user-chip', '.quick-link', '.menu-pop .menu-item',
].join(', ')

let pressInstalled = false

export function installPressFeedback() {
  if (pressInstalled || typeof window === 'undefined') return
  pressInstalled = true
  const pressed = new Set<Element>()

  const release = () => {
    pressed.forEach(el => gsap.to(el, { scale: 1, duration: DUR.release, ease: EASE.settle, overwrite: 'auto' }))
    pressed.clear()
  }

  document.addEventListener('pointerdown', (event) => {
    if (skipMotion() || event.button !== 0) return
    const el = (event.target as Element | null)?.closest(PRESSABLE)
    if (!el || (el as HTMLButtonElement).disabled) return
    pressed.add(el)
    gsap.to(el, { scale: 0.955, duration: DUR.press, ease: 'power2.out', overwrite: 'auto' })
  }, { passive: true })
  window.addEventListener('pointerup', release, { passive: true })
  window.addEventListener('pointercancel', release, { passive: true })
}

/* ── 悬停抬起：只给可点的卡片（hover 写 y，press 写 scale，两条通道互不覆盖） ── */
let hoverInstalled = false

export function installHoverLift() {
  if (hoverInstalled || typeof window === 'undefined') return
  if (!window.matchMedia('(hover: hover)').matches) return
  hoverInstalled = true
  const SELECTOR = '.lift'
  document.addEventListener('pointerover', (event) => {
    if (skipMotion()) return
    const el = (event.target as Element | null)?.closest(SELECTOR)
    if (!el || el.contains(event.relatedTarget as Node | null)) return
    gsap.to(el, { y: -3, duration: DUR.hoverIn, ease: EASE.glide, overwrite: 'auto' })
  })
  document.addEventListener('pointerout', (event) => {
    const el = (event.target as Element | null)?.closest(SELECTOR)
    if (!el || el.contains(event.relatedTarget as Node | null)) return
    gsap.to(el, { y: 0, duration: DUR.hoverOut, ease: EASE.settle, overwrite: 'auto' })
  })
}

/* ── 容器级指针光：坐标写在容器自身（叶子），不写在上层 ── */
export function trackGlow(event: PointerEvent) {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--px', `${event.clientX - rect.left}px`)
  el.style.setProperty('--py', `${event.clientY - rect.top}px`)
}

/* ── 页面切换：离场退纵深，进场推进，子元素按阅读序显现 ── */

/**
 * 过渡容器是路由外框，显现类要落在页面根 .page 上（样式与首屏还原都以它为锚点）；
 * 页面根不是 .page 时退回容器本身。
 */
function pageRootOf(el: Element): HTMLElement | null {
  if (!el || el.nodeType !== 1) return null
  const node = el as HTMLElement
  if (node.classList.contains('page')) return node
  return node.querySelector<HTMLElement>(':scope > .page') ?? node
}

export function pageLeave(el: Element, done: () => void) {
  const page = pageRootOf(el)
  // out-in 模式下同步调用 done 会让 Vue 在补丁过程中重渲染，必须推迟到本轮之后
  if (!page || skipMotion()) {
    setTimeout(done, 0)
    return
  }
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    done()
  }
  gsap.to(page, { opacity: 0, scale: 0.988, duration: DUR.pageOut, ease: EASE.exit, onComplete: finish })
  // 补间被打断（节点提前卸载等）也要放行，否则 out-in 卡死、新页面永远进不来
  setTimeout(finish, (DUR.pageOut + 0.5) * 1000)
}

export function pageEnter(el: Element, done: () => void) {
  const page = pageRootOf(el)
  if (!page || skipMotion() || page.classList.contains('is-entrance-ready')) {
    page?.classList.add('is-entrance-ready')
    return done()
  }
  const items = page.querySelectorAll('.reveal')
  const cards = page.querySelectorAll('.bento')
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    gsap.set(page, { clearProps: 'transform' })
    done()
  }
  // 隐藏态写在时间轴开头的 set 里，内部只用 to 推进
  gsap.set(page, { opacity: 1, scale: 0.994 })
  if (items.length) gsap.set(items, { opacity: 0, y: 12 })
  if (cards.length) gsap.set(cards, { opacity: 0, y: 18 })
  page.classList.add('is-entrance-ready')
  const tl = gsap.timeline({ onComplete: finish })
  tl.to(page, { scale: 1, duration: DUR.pageIn, ease: EASE.glide }, 0)
  if (items.length) tl.to(items, { opacity: 1, y: 0, duration: DUR.pageIn, ease: EASE.reveal, stagger: { each: 0.05, from: 'start' }, clearProps: 'transform' }, 0.04)
  // 并列卡片从中间向两侧展开
  if (cards.length) tl.to(cards, { opacity: 1, y: 0, duration: 0.72, ease: EASE.reveal, stagger: { each: 0.045, from: 'center' }, clearProps: 'opacity,transform' }, 0.1)
  // 兜底：时间轴被页面隐藏 / 提前卸载打断时，直接把内容落到终态
  setTimeout(() => {
    if (settled) return
    gsap.set([page, ...Array.from(items), ...Array.from(cards)], { clearProps: 'opacity,transform' })
    finish()
  }, 2600)
}

/** 首屏页面（无过渡钩子时）：同样走一遍进场 */
export function revealPage(page: HTMLElement | null) {
  if (!page || page.classList.contains('is-entrance-ready')) return
  pageEnter(page, () => {})
}

/* ── 外壳首次入场：品牌 → 导航组（from start）→ 顶栏 ── */
export function playShellEntrance(frame: HTMLElement) {
  if (skipMotion()) {
    frame.classList.add('is-entrance-ready')
    return
  }
  const brand = frame.querySelectorAll('.rail-brand')
  const groups = frame.querySelectorAll('.nav-group')
  const top = frame.querySelectorAll('.topbar > *')
  const tl = gsap.timeline({ paused: true })
  tl.set([...brand, ...groups, ...top], { opacity: 0, y: 8 })
  tl.add(() => frame.classList.add('is-entrance-ready'))
  tl.to(brand, { opacity: 1, y: 0, duration: 0.6, ease: EASE.reveal }, 0)
  tl.to(groups, { opacity: 1, y: 0, duration: 0.6, ease: EASE.reveal, stagger: { each: 0.06, from: 'start' } }, 0.08)
  tl.to(top, { opacity: 1, y: 0, duration: 0.5, ease: EASE.reveal, stagger: 0.04 }, 0.14)
  tl.add(() => gsap.set([...brand, ...groups, ...top], { clearProps: 'transform' }))
  afterTwoFrames(() => tl.play(0))
}

/* ── 滑动玻璃块：导航选中、分段滑块共用（transform 归 GSAP） ── */
export function slideThumb(thumb: HTMLElement | null, target: HTMLElement | null, axis: 'x' | 'y', instant = false) {
  const parent = thumb?.offsetParent as HTMLElement | null
  if (!thumb || !target || !parent) return
  // 用几何差值定位：目标与滑块不必是同一个定位父级。
  // 祖先若正在缩放（弹窗 / 命令面板从触发点展开），包围盒带着缩放比例，需折算回布局像素，
  // 否则首帧量到的位置与宽度偏小，滑块错位直到下次切换才纠正
  const pr = parent.getBoundingClientRect()
  const tr = target.getBoundingClientRect()
  const sx = parent.offsetWidth ? pr.width / parent.offsetWidth : 1
  const sy = parent.offsetHeight ? pr.height / parent.offsetHeight : 1
  const kx = sx > 0.01 ? sx : 1
  const ky = sy > 0.01 ? sy : 1
  const props = axis === 'y'
    ? { y: (tr.top - pr.top) / ky - parent.clientTop + parent.scrollTop, height: tr.height / ky }
    : { x: (tr.left - pr.left) / kx - parent.clientLeft + parent.scrollLeft, width: tr.width / kx }
  if (instant || skipMotion()) {
    gsap.set(thumb, props)
    return
  }
  gsap.to(thumb, { ...props, duration: DUR.slide, ease: EASE.glide, overwrite: true })
}

/* ── 最近一次指针按下的位置：弹窗据此从触发点展开（键盘打开时为 null，回落中心） ── */
export const lastPointer: { x: number; y: number; at: number } = { x: 0, y: 0, at: 0 }
let pointerTracked = false
function trackPointer() {
  if (pointerTracked || typeof document === 'undefined') return
  pointerTracked = true
  document.addEventListener('pointerdown', (event) => {
    lastPointer.x = event.clientX
    lastPointer.y = event.clientY
    lastPointer.at = performance.now()
  }, { capture: true, passive: true })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') lastPointer.at = 0
  }, { capture: true, passive: true })
}
trackPointer()

/** 刚刚（600ms 内）由指针触发的打开动作才有「来处」 */
function recentPointer() {
  return lastPointer.at && performance.now() - lastPointer.at < 600 ? lastPointer : null
}

/** 最近一次指针按下位置下方、匹配选择器的元素（共享元素的「来处」）；键盘触发时为 null */
export function originAtPointer(selector: string) {
  const point = recentPointer()
  if (!point) return null
  return document.elementFromPoint(point.x, point.y)?.closest(selector) ?? null
}

/** 弹窗原点：触发点相对面板的位置，限制在面板外扩一圈内，避免从屏幕角落飞入 */
function originOf(panel: Element) {
  const point = recentPointer()
  if (!point) return '50% 50%'
  const r = panel.getBoundingClientRect()
  const x = Math.min(Math.max(point.x - r.left, -r.width * 0.25), r.width * 1.25)
  const y = Math.min(Math.max(point.y - r.top, -r.height * 0.25), r.height * 1.25)
  return `${x}px ${y}px`
}

/* ── 浮层：弹窗 / 抽屉 / 下拉 ── */
export function overlayEnter(el: Element, done: () => void, kind: 'modal' | 'drawer' | 'pop' = 'modal', origin?: Element | null) {
  const panel = el.querySelector('.modal, .drawer') ?? el
  if (skipMotion()) return done()
  const tl = gsap.timeline({ onComplete: done })
  if (kind === 'pop') {
    tl.fromTo(el, { opacity: 0, y: -6, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: EASE.reveal, clearProps: 'transform' })
    return
  }
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out' }, 0)
  if (kind === 'drawer') {
    // 共享元素：一块玻璃从被点的行生长成抽屉，内容随后显现（放 Discharge）
    if (origin && document.contains(origin)) {
      const ghost = morphGhost(origin.getBoundingClientRect(), panel.getBoundingClientRect())
      gsap.set(panel, { opacity: 0 })
      tl.add(ghost, 0)
      tl.to(panel, { opacity: 1, duration: 0.26, ease: 'power1.out' }, 0.3)
      tl.fromTo(panel.querySelectorAll('.drawer-head, .drawer-body > *, .drawer-foot'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.42, ease: EASE.reveal, stagger: 0.03, clearProps: 'opacity,transform' }, 0.34)
      return
    }
    tl.fromTo(panel, { x: 36, opacity: 0 }, { x: 0, opacity: 1, duration: DUR.overlayIn + 0.1, ease: EASE.glide, clearProps: 'transform' }, 0)
  } else {
    gsap.set(panel, { transformOrigin: originOf(panel) })
    const from = recentPointer() ? { scale: 0.86, opacity: 0, y: 0 } : { y: 14, scale: 0.975, opacity: 0 }
    tl.fromTo(panel, from, { y: 0, scale: 1, opacity: 1, duration: DUR.overlayIn + 0.06, ease: EASE.reveal, clearProps: 'transform,transformOrigin' }, 0.02)
  }
}

export function overlayLeave(el: Element, done: () => void, kind: 'modal' | 'drawer' | 'pop' = 'modal', origin?: Element | null) {
  if (skipMotion()) return done()
  const panel = el.querySelector('.modal, .drawer') ?? el
  const tl = gsap.timeline({ onComplete: done })
  if (kind === 'pop') {
    tl.to(el, { opacity: 0, y: -4, duration: 0.14, ease: EASE.exit })
    return
  }
  if (kind === 'drawer' && origin && document.contains(origin)) {
    // 收回原行（停摆 Halt）：内容先退，玻璃再缩回来处
    const ghost = morphGhost(panel.getBoundingClientRect(), origin.getBoundingClientRect(), true)
    tl.to(panel, { opacity: 0, duration: 0.14, ease: EASE.exit }, 0)
    tl.add(ghost, 0.06)
    tl.to(el, { opacity: 0, duration: 0.3, ease: EASE.exit }, 0.08)
    return
  }
  if (kind === 'drawer') tl.to(panel, { x: 24, duration: DUR.overlayOut, ease: EASE.exit }, 0)
  else tl.to(panel, { scale: 0.94, opacity: 0, duration: DUR.overlayOut, ease: EASE.exit }, 0)
  tl.to(el, { opacity: 0, duration: DUR.overlayOut, ease: EASE.exit }, 0)
}

/** 一块独立的玻璃从 from 矩形变形到 to 矩形，结束即移除；只服务于抽屉共享元素 */
function morphGhost(from: DOMRect, to: DOMRect, closing = false) {
  const ghost = document.createElement('div')
  ghost.className = 'morph-ghost'
  document.body.appendChild(ghost)
  const tl = gsap.timeline({ onComplete: () => ghost.remove() })
  gsap.set(ghost, { left: 0, top: 0, x: from.left, y: from.top, width: from.width, height: from.height, opacity: closing ? 1 : 0.9 })
  tl.to(ghost, { x: to.left, y: to.top, width: to.width, height: to.height, duration: closing ? 0.36 : 0.5, ease: closing ? EASE.swap : EASE.glide })
  tl.to(ghost, { opacity: 0, duration: closing ? 0.16 : 0.22, ease: 'power1.out' }, closing ? '-=0.12' : '-=0.18')
  return tl
}

/* ── 底部浮条（批量操作、未保存变更）：从底部升起（放），收回时下沉（停摆） ── */
export function floatBarEnter(el: Element, done: () => void) {
  if (skipMotion()) return done()
  gsap.fromTo(el, { y: 40, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.56, ease: EASE.settle, clearProps: 'transform', onComplete: done })
}
export function floatBarLeave(el: Element, done: () => void) {
  if (skipMotion()) return done()
  gsap.to(el, { y: 30, opacity: 0, duration: 0.22, ease: EASE.exit, onComplete: done })
}

/* ── 主按钮涟漪：从真正被点到的位置化开（放 Discharge），键盘触发落回中心 ── */
let rippleInstalled = false
export function installRipple() {
  if (rippleInstalled || typeof window === 'undefined') return
  rippleInstalled = true
  const fire = (button: HTMLElement, x?: number, y?: number) => {
    if (skipMotion()) return
    const rect = button.getBoundingClientRect()
    const px = x === undefined ? rect.width / 2 : x - rect.left
    const py = y === undefined ? rect.height / 2 : y - rect.top
    const radius = Math.max(
      Math.hypot(px, py), Math.hypot(rect.width - px, py),
      Math.hypot(px, rect.height - py), Math.hypot(rect.width - px, rect.height - py),
    )
    let clip = button.querySelector<HTMLElement>(':scope > .ripple-clip')
    if (!clip) {
      clip = document.createElement('span')
      clip.className = 'ripple-clip'
      clip.setAttribute('aria-hidden', 'true')
      button.appendChild(clip)
    }
    const dot = document.createElement('span')
    dot.className = 'ripple-dot'
    clip.appendChild(dot)
    gsap.set(dot, { left: px, top: py, xPercent: -50, yPercent: -50, width: 20, height: 20 })
    gsap.timeline({ onComplete: () => dot.remove() })
      .to(dot, { scale: (radius * 2.2) / 20, duration: 0.62, ease: EASE.reveal }, 0)
      .to(dot, { opacity: 0, duration: 0.42, ease: 'power1.out' }, 0.2)
  }
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const button = (event.target as Element | null)?.closest<HTMLElement>('.btn-primary, .btn-danger')
    if (button && !(button as HTMLButtonElement).disabled) fire(button, event.clientX, event.clientY)
  }, { passive: true })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const button = (event.target as Element | null)?.closest<HTMLElement>('.btn-primary, .btn-danger')
    if (button && !(button as HTMLButtonElement).disabled) fire(button)
  })
}

/* ── 群组进场：列表行按阅读序（结 Crystallize） ── */
export function revealRows(rows: ArrayLike<Element>) {
  if (skipMotion() || !rows.length) return
  const list = Array.from(rows).slice(0, 14)
  gsap.fromTo(list, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.5, ease: EASE.reveal, stagger: { each: 0.025, from: 'start' }, clearProps: 'opacity,transform' })
}

/** 状态确认：一次 back.out 的 scale 弹入，不用 opacity 脉冲 */
export function settlePop(el: Element | null) {
  if (!el || skipMotion()) return
  gsap.fromTo(el, { scale: 0.6 }, { scale: 1, duration: 0.42, ease: EASE.settle, clearProps: 'transform' })
}

/** 折线描绘：数据沿路径推进（导 Conduct） */
export function drawPath(path: SVGPathElement | null, area?: SVGPathElement | null) {
  if (!path) return
  if (skipMotion()) return
  const length = path.getTotalLength()
  gsap.fromTo(path, { strokeDasharray: length, strokeDashoffset: length }, {
    strokeDashoffset: 0, duration: 1.1, ease: EASE.swap, clearProps: 'strokeDasharray,strokeDashoffset',
  })
  if (area) gsap.fromTo(area, { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.5, ease: 'power1.out' })
}

/* ── 关系图与常驻动画的物理底座 ──────────────────────────────── */

/** 弹簧状态：x 当前值，v 速度 */
export interface SpringState { x: number; v: number }
export const springOf = (x: number): SpringState => ({ x, v: 0 })

/** 临界阻尼弹簧：每帧把 state 推向 target，返回新值。k 越大越硬（62 ≈ 0.5s 落定） */
export function spring(state: SpringState, target: number, dt: number, k = 62) {
  const c = 2 * Math.sqrt(k)
  state.v += (-k * (state.x - target) - c * state.v) * dt
  state.x += state.v * dt
  return state.x
}

/** 三次贝塞尔上 u 处的坐标分量 */
export function bezierAt(p0: number, p1: number, p2: number, p3: number, u: number) {
  const m = 1 - u
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3
}

/**
 * 常驻帧循环：挂在 gsap.ticker 上，页面隐藏或元素离开视口时停帧（导 Conduct）。
 * 回调拿到 dt（秒，限制在 1/30 内）与累计时间 t；单帧出错只报一次，不让循环停摆。
 */
export function createFrameLoop(step: (dt: number, t: number) => void) {
  let target: Element | null = null
  let offscreen = false
  let frames = 0
  let running = false
  let last = 0
  let time = 0
  let warned = false
  const run = (force: boolean) => {
    if (document.hidden && !force) { last = 0; return }
    // 每 20 帧量一次位置：离开视口就停帧（比 IntersectionObserver 更不受过渡与隐藏祖先影响）
    if (target && (offscreen || frames++ % 20 === 0)) {
      const r = target.getBoundingClientRect()
      offscreen = r.width === 0 || r.bottom < 0 || r.top > window.innerHeight
    }
    if (offscreen && !force) { last = 0; return }
    const now = performance.now()
    const dt = last ? Math.max(0, Math.min(1 / 30, (now - last) / 1000)) : 1 / 60
    last = now
    time += dt
    try { step(dt, time) } catch (error) {
      if (!warned) { warned = true; console.error(error) }
    }
  }
  const tick = () => run(false)
  return {
    start(el?: Element | null) {
      if (running) return
      running = true
      last = 0
      target = el ?? null
      gsap.ticker.add(tick)
    },
    stop() {
      running = false
      gsap.ticker.remove(tick)
      target = null
    },
    /** 立即执行一帧（减少动态效果时用来直接画到终态） */
    flush() { run(true) },
    get time() { return time },
  }
}

/** 面板内容级联浮现：分析栏、抽屉正文等（结 Crystallize） */
export function revealCascade(container: Element | null, selector = ':scope > *', gap = 0.075) {
  if (!container || skipMotion()) return
  const items = Array.from(container.querySelectorAll(selector)).slice(0, 18)
  if (!items.length) return
  gsap.fromTo(items, { opacity: 0, y: 10 }, {
    opacity: 1, y: 0, duration: 0.56, ease: EASE.reveal, stagger: { each: gap, from: 'start' }, clearProps: 'opacity,transform', overwrite: 'auto',
  })
}

/** 打字机：逐字写出 text，结束回调 done；减少动态效果时一次写完。返回取消函数 */
export function typeOut(text: string, write: (value: string) => void, done?: () => void, speed = 42) {
  if (skipMotion()) {
    write(text)
    done?.()
    return () => {}
  }
  let i = 0
  write('')
  const timer = window.setInterval(() => {
    i += 1
    write(text.slice(0, i))
    if (i >= text.length) {
      window.clearInterval(timer)
      window.setTimeout(() => done?.(), 180)
    }
  }, speed)
  return () => window.clearInterval(timer)
}

/** 本会话是否首次出现某段开场（开场只播一次，刷新后同会话不再重播） */
export function firstTimeInSession(key: string) {
  try {
    const storageKey = `scaffold.intro.${key}`
    if (sessionStorage.getItem(storageKey)) return false
    sessionStorage.setItem(storageKey, '1')
    return true
  } catch {
    return false
  }
}

/**
 * 共享布局变形（Flip）：先记下 targets 的位置，执行 mutate（改 class / 数据并等 DOM 更新），
 * 再从旧位置平滑过渡到新布局。样本册卡片展开、看板重排共用。
 */
export async function flipLayout(targets: Element[] | NodeListOf<Element>, mutate: () => void | Promise<void>) {
  const list = Array.from(targets)
  if (skipMotion() || !list.length) { await mutate(); return }
  const state = Flip.getState(list)
  await mutate()
  Flip.from(state, { duration: 0.62, ease: EASE.glide, absolute: false, nested: true, prune: true, simple: true })
}

/** 是否应跳过过程动画（reduced motion 或页面在后台） */
export function motionSkipped() {
  return skipMotion()
}

export { gsap }
