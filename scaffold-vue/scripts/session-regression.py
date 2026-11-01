"""本地浏览器回归：登录竞态、菜单与按钮权限、旧账号请求晚到。

需要已安装的 Python Playwright/Chromium 与运行中的前后端。
后端必须以 CAPTCHA_ENABLED=false 启动（与 scaffold-admin 的 surefire 同一口径）：
验证码答案只存 Redis、接口只回图片，脚本读不到答案，因此这里不在有验证码的实例上跑。
创建并删除自己生成的测试角色/用户，建议连接独立校验库；不清空任何表。
密码通过 SCAFFOLD_TEST_PASSWORD 传入，本地种子库默认使用开发账号。
"""
import argparse
import asyncio
import os
import secrets
import time
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect


async def sign_in(page, username, password, destination=None):
    await page.wait_for_url("**/login**")
    await page.get_by_role("button", name="登录", exact=True).wait_for()
    await expect(page.get_by_role("button", name="登录", exact=True)).to_be_enabled()
    # 验证码只回图片、答案不出服务端，因此本回归要求后端在 CAPTCHA_ENABLED=false 下运行。
    # Login.vue 的 captchaEnabled 初值是 true，等 /api/auth/captcha 回 false 才撤掉输入位，
    # 所以这里等它从 DOM 移除再判，不能立刻查存在——否则会把首屏瞬时渲染误读成开启了验证码。
    captcha_box = page.get_by_role("button", name="看不清，换一张", exact=True)
    try:
        await captcha_box.wait_for(state="detached", timeout=8000)
    except Exception:
        raise RuntimeError("登录页仍渲染图形验证码：请用 CAPTCHA_ENABLED=false 启动后端后再跑本回归")
    await page.get_by_placeholder("请输入账号", exact=True).fill(username)
    await page.get_by_placeholder("请输入密码", exact=True).fill(password)
    await page.get_by_role("button", name="登录", exact=True).click()
    if destination:
        try:
            await page.wait_for_url("**" + destination, timeout=10000)
        except Exception:
            print("登录落点异常：", page.url, "提示：", await page.locator(".login-error, .field-error, .toast").all_text_contents())
            raise
        await page.locator("main").wait_for(state="visible")


async def sign_out(page):
    await page.locator(".user-chip").click()
    await page.get_by_role("menuitem", name="退出登录").click()
    await page.get_by_role("dialog").get_by_role("button", name="退出", exact=True).click()
    await page.wait_for_url("**/login**")


async def request_health(page, wait=True):
    # 使用应用实际加载的模块 URL，避免 Vite 的版本参数形成第二个 HTTP 模块实例。
    await page.evaluate("""async (wait) => {
      const source = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/api/http.ts'));
      const {httpClient} = await import(source.name);
      const request = httpClient.get('/health').catch(() => {});
      if (wait) await request;
    }""", wait)


async def main(base_url):
    password = os.environ.get("SCAFFOLD_TEST_PASSWORD", "admin123")
    suffix = str(time.time_ns())
    username, role_code = "ui_read_" + suffix, "ui_role_" + suffix
    fixture_password = secrets.token_urlsafe(18)
    async with async_playwright() as playwright:
        api = await playwright.request.new_context(base_url=base_url + "/api/")
        browser = await playwright.chromium.launch(headless=True)
        role_id = user_id = None
        try:
            captcha = (await (await api.get("auth/captcha")).json())["data"]
            assert captcha["captchaEnabled"] == "false", "后端未关闭验证码，本回归需在 CAPTCHA_ENABLED=false 下运行"
            response = await api.post("auth/login", data={"username": "admin", "password": password,
                "captcha": "", "captchaUuid": captcha["uuid"]})
            assert response.ok, "测试管理员登录失败"
            token = (await response.json())["data"]["token"]
            await api.dispose()
            api = await playwright.request.new_context(base_url=base_url + "/api/", extra_http_headers={"Authorization": "Bearer " + token})
            response = await api.post("system/roles", data={"name": "浏览器只读回归", "code": role_code,
                "dataScope": "SELF", "sort": 99, "status": 1, "menuIds": [100, 101]})
            assert response.ok, "测试角色创建失败"
            role_id = (await response.json())["data"]["id"]
            response = await api.post("system/users", data={"username": username, "password": fixture_password,
                "nickname": "浏览器只读回归", "deptId": 5, "status": 1, "roleIds": [role_id]})
            assert response.ok, "测试用户创建失败"
            user_id = (await response.json())["data"]["id"]

            page = await browser.new_page()
            errors = []
            unexpected = []
            requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("response", lambda response: unexpected.append((urlparse(response.url).path, response.status))
                if "/api/" in response.url and response.status >= 400 and urlparse(response.url).path != "/api/health" else None)
            page.on("response", lambda response: requests.append((urlparse(response.url).path, response.status)) if "/api/" in response.url else None)
            await page.goto(base_url)

            # 首次菜单请求晚到：在旧账号初始化过程中模拟会话过期。
            routes_started, release_routes = asyncio.Event(), asyncio.Event()
            first_route = True

            async def hold_old_routes(route):
                nonlocal first_route
                if not first_route:
                    await route.continue_()
                    return
                first_route = False
                response = await route.fetch()
                routes_started.set()
                await release_routes.wait()
                await route.fulfill(response=response)

            await page.route("**/api/auth/routes", hold_old_routes)
            await sign_in(page, "admin", password)
            await asyncio.wait_for(routes_started.wait(), 5)

            async def expired(route):
                await route.fulfill(status=401, json={"code": 401, "message": "登录已过期", "data": None})

            await page.route("**/api/health", expired)
            await request_health(page)
            await page.wait_for_url("**/login**")
            await page.unroute("**/api/health")
            await sign_in(page, username, fixture_password, "/system/user")
            release_routes.set()
            await page.wait_for_load_state("networkidle")
            assert await page.locator(".nav-item").all_text_contents() == ["用户管理"], "旧菜单写回或越权菜单可见"
            assert await page.get_by_role("button", name="新增用户", exact=True).count() == 0, "只读用户看到新增按钮"
            assert await page.get_by_role("button", name="编辑", exact=True).count() == 0, "只读用户看到编辑按钮"
            await page.unroute("**/api/auth/routes")
            await page.goto(base_url + "/system/role")
            await expect(page.get_by_text("页面不存在或没有访问权限", exact=True)).to_be_visible()
            await page.get_by_role("button", name="返回首页").click()
            await page.wait_for_url("**/system/user")
            print("PASS: 旧菜单晚到、低权限落点、按钮隐藏与直接访问限制")

            # 旧账号的 401 与慢退出请求均不得影响随后登录的账号。
            pending_401, release_401 = asyncio.Event(), asyncio.Event()
            pending_logout, release_logout = asyncio.Event(), asyncio.Event()

            async def late_401(route):
                pending_401.set()
                await release_401.wait()
                await expired(route)

            async def slow_logout(route):
                pending_logout.set()
                await release_logout.wait()
                await route.continue_()

            await page.route("**/api/health", late_401)
            await request_health(page, wait=False)
            await asyncio.wait_for(pending_401.wait(), 5)
            await page.route("**/api/auth/logout", slow_logout)
            await sign_out(page)
            await asyncio.wait_for(pending_logout.wait(), 5)
            await sign_in(page, "admin", password, "/dashboard")
            release_401.set()
            release_logout.set()
            await page.wait_for_load_state("networkidle")
            assert page.url.endswith("/dashboard"), "旧请求清除了新登录态"
            # 工作台 + 系统管理 8（含资源监测）+ 两类日志 + 代码生成
            assert await page.locator(".nav-item").count() == 12, "管理员菜单不完整"
            await page.unroute("**/api/health")
            await page.unroute("**/api/auth/logout")
            await sign_out(page)
            await sign_in(page, "chensy", password, "/no-access")
            await expect(page.get_by_text("暂未分配可用菜单", exact=True)).to_be_visible()
            await page.reload()
            await expect(page.get_by_text("暂未分配可用菜单", exact=True)).to_be_visible()
            assert not errors, "浏览器运行错误：" + str(errors)
            assert not unexpected, "非预期接口失败：" + str(unexpected)
            print("PASS: 慢退出、旧 401、重新登录及无菜单账号刷新")
        except Exception:
            print("最近接口状态：", requests[-14:] if 'requests' in locals() else [])
            raise
        finally:
            if user_id:
                response = await api.delete("system/users/" + str(user_id))
                assert response.ok, "测试用户清理失败"
            if role_id:
                response = await api.delete("system/roles/" + str(role_id))
                assert response.ok, "测试角色清理失败"
            await api.dispose()
            await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:5173")
    args = parser.parse_args()
    asyncio.run(main(args.base_url.rstrip("/")))
