import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebOpener, exchangeWebLink, interceptWebLinks } from "../src/web-link.js";

const base = "https://ee.example.com";

function fakeHttp(respond: (path: string, body: any) => Response | Promise<Response>) {
  const calls: { path: string; body: any }[] = [];
  return {
    calls,
    fetch: async (path: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      return respond(path, body);
    },
  };
}

test("免登录链接：只换 dsh-ee 自己的网页，换不到就用原链接", async () => {
  const http = fakeHttp(() => Response.json({ url: `${base}/api/auth/handoff?code=abc` }));
  assert.equal(await exchangeWebLink(base, http, `${base}/knowledge/docs/3?v=2#L4`), `${base}/api/auth/handoff?code=abc`);
  assert.deepEqual(http.calls, [{ path: "/api/dsh/web-link", body: { next: "/knowledge/docs/3?v=2#L4" } }]);

  // 别的网站、相似前缀、接口地址都不换
  for (const url of ["https://other.example/x", `${base}.evil.com/x`, `${base}/api/admin/users`]) {
    assert.equal(await exchangeWebLink(base, http, url), url);
  }
  assert.equal(http.calls.length, 1);

  // 旧版服务端（404）、网络错误、返回了奇怪的地址：用原链接
  const old = fakeHttp(() => new Response("not found", { status: 404 }));
  assert.equal(await exchangeWebLink(base, old, `${base}/apps`), `${base}/apps`);
  const broken = fakeHttp(() => { throw new Error("offline"); });
  assert.equal(await exchangeWebLink(base, broken, `${base}/apps`), `${base}/apps`);
  const weird = fakeHttp(() => Response.json({ url: "javascript:alert(1)" }));
  assert.equal(await exchangeWebLink(base, weird, `${base}/apps`), `${base}/apps`);
});

test("前端打开网页：用后端换来的链接；旧版后端没有 webLink 时打开原链接", async () => {
  const opened: string[] = [];
  const open = (url: string) => { opened.push(url); };
  await createWebOpener({ webLink: async ({ url }: any) => ({ value: `${url}#handoff` }) }, (r) => r.value, open)(`${base}/apps`);
  await createWebOpener({}, (r) => r, open)(`${base}/apps`);
  await createWebOpener({ webLink: async () => { throw new Error("boom"); } }, (r) => r, open)(`${base}/apps`);
  assert.deepEqual(opened, [`${base}/apps#handoff`, `${base}/apps`, `${base}/apps`]);
});

test("拦截面板里的链接：只拦新窗口打开的 dsh-ee 链接，修饰键照浏览器默认", () => {
  const opened: string[] = [];
  const handler = interceptWebLinks(() => base, (url) => opened.push(url));
  const anchor = (href: string, target = "_blank") => ({ getAttribute: (name: string) => (name === "href" ? href : name === "target" ? target : null) });
  const click = (a: any, extra: Record<string, any> = {}) => {
    let prevented = false;
    handler({ button: 0, target: { closest: () => a }, preventDefault: () => { prevented = true; }, ...extra });
    return prevented;
  };
  assert.equal(click(anchor(`${base}/connections/crm`)), true);
  assert.equal(click(anchor(`${base}/connections/crm`), { metaKey: true }), false);
  assert.equal(click(anchor(`${base}/connections/crm`, "_self")), false);
  assert.equal(click(anchor("https://other.example/x")), false);
  assert.equal(click(null), false);
  assert.deepEqual(opened, [`${base}/connections/crm`]);
});
