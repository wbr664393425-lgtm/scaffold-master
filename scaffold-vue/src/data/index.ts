/* ============================================================
   品牌与全局配置：换品牌只改这里。
   ============================================================ */
export interface BeianItem {
  /** 备案号显示文本，须与工信部 / 公安备案截图一致 */
  text: string
  /** 官方查询地址 */
  link: string
}

export const APP = Object.freeze({
  name: '通用后台管理系统',
  shortName: '管理后台',
  subtitle: 'Admin Console',
  version: 'v1.0.0',
  /** 登录页左侧介绍位：接入具体业务平台时改这一段 */
  platform: Object.freeze({
    eyebrow: '通用后台底座',
    slogan: ['统一的后台底座，', '专注业务本身。'],
    lead: '用户、角色、菜单、部门、字典与审计开箱即用，新业务模块只需关注字段与流程。',
  }),
  /** 登录页页脚：版权主体公司名称 */
  company: '通用后台管理系统',
  /** 登录页页脚备案条目；脚手架不带备案信息，接入实际站点时按 BeianItem 填写 */
  beian: Object.freeze([] as readonly BeianItem[]),
})

/* ── 导航 ─────────────────────────────────────────────────── */
export interface NavLeaf {
  key: string
  label: string
  icon: string
  path: string
}

export interface NavGroup {
  key: string
  label: string
  icon: string
  /** 顶层单页菜单（如工作台）没有分组标题 */
  single?: boolean
  items: NavLeaf[]
}

/* ── 业务行类型（与后端返回字段对应） ─────────────────────── */
export interface BaseRow {
  id: number
  status: number
  createTime?: string
  [key: string]: any
}

export interface Menu extends BaseRow {
  name: string
  parentId: number
  type: 'dir' | 'menu' | 'btn'
  icon?: string
  path?: string
  component?: string
  permission?: string
  visible?: number
  sort?: number
  children?: Menu[]
}

export interface Dept extends BaseRow {
  name: string
  parentId: number
  leader?: string
  phone?: string
  email?: string
  sort?: number
  memberCount?: number
  children?: Dept[]
}

/** 头像底色：由名称稳定映射，避免同一个人每次颜色不同 */
export const AVATAR_TINTS = ['#236de9', '#3f9d3a', '#4b5a63', '#2f8f9d', '#7a5cd6', '#c2603e']
