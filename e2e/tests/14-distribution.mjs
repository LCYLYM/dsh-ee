import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const version = `9.9.9-e2e-${tag}`;
  const file = `desktop-${tag}.zip`;
  const content = Buffer.from(`desktop-e2e-${tag}`);
  const dataDir = process.env.E2E_DATA_DIR || "/tmp/dsh-ee/data";
  const localPath = path.join(dataDir, "dsh-releases", "mac-arm64", file);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, content);
  const release = {
    target: "mac-arm64",
    kind: "zip",
    version,
    file,
    size: content.length,
    sha512: createHash("sha512").update(content).digest("base64"),
    local_path: localPath,
    upstream_url: "https://download.deepseek.com/e2e.zip",
  };
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  execFileSync("go", ["run", path.join(testDir, "seed-release.go")], {
    cwd: path.resolve(testDir, "../../server"),
    env: {
      ...process.env,
      E2E_DSN: process.env.E2E_DSN || "root:@tcp(127.0.0.1:4000)/",
      E2E_DB: process.env.E2E_DB || "dsh_ee",
      E2E_RELEASE: JSON.stringify(release),
    },
    stdio: "pipe",
  });

  await admin.goto(`${BASE}/admin/distribution`);
  await admin.getByRole("heading", { name: "DSH 分发" }).waitFor();
  const row = admin.getByRole("row").filter({ hasText: version });
  await row.waitFor();
  await shot(admin, "distribution-admin");
  await row.getByRole("button", { name: "设为推荐" }).click();
  await row.getByText("企业推荐", { exact: true }).waitFor();
  step("管理员页面列出真实镜像版本并设置推荐");

  const username = `distribution-${tag}`;
  const password = "distribution-password-1";
  assertEq((await api(admin, "POST", "/api/admin/users", { username, password })).status, 201, "创建员工");
  // CI 的 Chrome 跑在 Linux 上，默认会看到「Windows 即将支持」；
  // 这个测试验证的是 Mac 安装包，所以显式伪装成 Mac，且去掉 UA-CH 避免推断成 x64。
  const employee = await newPage(t, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
  await employee.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
  await login(employee, username, password);
  await employee.goto(`${BASE}/dsh`);
  await employee.getByRole("heading", { name: "① 下载 DSH Desktop" }).waitFor();
  await employee.getByText(version, { exact: false }).waitFor();
  const link = employee.getByRole("link", { name: "下载", exact: true }).first();
  const href = await link.getAttribute("href");
  assert(href.endsWith(`/dl/mac-arm64/${file}`), "员工下载链接使用真实文件");
  const downloaded = await employee.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: "bytes=0-3" } });
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()).length };
  }, href);
  assert(downloaded.status === 200 || downloaded.status === 206, `下载状态 ${downloaded.status}`);
  assertEq(downloaded.bytes, 4, "Range 下载字节数");
  step("员工页列出版本，登录下载支持 Range");

  const issued = await api(employee, "POST", "/api/me/tokens", { name: "Desktop E2E", scopes: ["models", "registry:read", "hub", "connections"] });
  assertEq(issued.status, 201, "创建插件令牌");
  const catalogStatus = await employee.evaluate(async ({ base, token }) => {
    const response = await fetch(`${base}/api/dsh/catalog`, {
      headers: { Authorization: `Bearer ${token}`, "X-DshEE-Client": "dsh-connect/1.0.7", "X-DshEE-Host": "desktop/0.2.1-rc.5" },
    });
    return response.status;
  }, { base: BASE, token: issued.data.token });
  assertEq(catalogStatus, 200, "模拟 Desktop 插件上线");
  await employee.getByText("✔ 已接入：DSH Desktop · 插件 1.0.7", { exact: true }).waitFor({ timeout: 10000 });
  await shot(employee, "distribution-download");
  step("四步引导检测 Desktop 插件上线并显示已接入");
}
