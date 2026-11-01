import type { HttpClient } from './http'

export interface LoginRequest {
  username: string
  password: string
  captcha: string
  captchaUuid: string
}

export interface CaptchaResponse {
  /** 后端验证码开关，关闭时前端不渲染验证码输入 */
  captchaEnabled: string
  uuid: string
  /** base64 PNG，已带 data:image/png;base64, 前缀；明文答案只存服务端 */
  img: string | null
}

export interface LoginResponse {
  token: string
  expiresIn: number
}

export interface ChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

export interface CurrentUser {
  id?: number
  username: string
  nickname: string
  deptId?: number
  deptName?: string
  roles: string[]
  permissions: string[]
}

export interface RouteItem {
  id?: number
  parentId?: number
  name: string
  routeName?: string
  routePath?: string
  path?: string
  component?: string
  icon?: string
  permission?: string
  children?: RouteItem[]
}

export interface RoutesResponse {
  routes: RouteItem[]
}

export function createAuthApi(client: HttpClient) {
  return {
    captcha: () => client.get<CaptchaResponse>('/auth/captcha'),
    login: (body: LoginRequest) => client.post<LoginResponse>('/auth/login', body),
    me: () => client.get<CurrentUser>('/auth/me'),
    routes: () => client.get<RoutesResponse>('/auth/routes'),
    changePassword: (body: ChangePasswordRequest) => client.put<void>('/auth/password', body),
    logout: () => client.post<void>('/auth/logout'),
  }
}
