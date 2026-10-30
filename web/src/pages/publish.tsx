import { useState } from "react";
import { Link } from "react-router";
import { UploadCloud } from "lucide-react";
import { categories } from "../mock/data";
import { useStore } from "../lib/store";
import type { Plugin, Visibility } from "../lib/types";
import { statusBadge } from "../components/status";
import { pluginPath } from "../components/plugin-card";
import { Button, Card, CopyBox, cx, Field, inputCls, PageHeader, Segmented } from "../components/ui";

const ME = "zhang.wei";


export default function Publish() {
  const { settings, plugins, addPlugin, notify } = useStore();
  const [way, setWay] = useState<"cli" | "web" | "request">("web");
  const [form, setForm] = useState({
    name: `${settings.scope}/`,
    title: "",
    version: "0.1.0",
    category: "tools",
    description: "",
    visibility: "company" as Visibility,
    file: "",
  });
  const scopeOk = form.name.startsWith(`${settings.scope}/`) && form.name.length > settings.scope.length + 1;
  const canSubmit = scopeOk && form.title.trim() && form.file;
  const mine = plugins.filter((p) => p.author === ME);

  const submit = () => {
    const p: Plugin = {
      name: form.name,
      title: form.title,
      description: form.description,
      author: ME,
      department: "研发效能部",
      icon: null,
      homepage: null,
      repository: null,
      category: form.category,
      featured: false,
      stars: 0,
      score: null,
      version: form.version,
      publishedAt: Math.floor(Date.now() / 1000),
      submittedAt: Math.floor(Date.now() / 1000),
      origin: "internal",
      installs: 0,
      depCount: 6,
      sizeKb: 180,
      offlineReady: true,
      hasInstallScript: false,
      status: "pending",
      visibility: form.visibility,
    };
    addPlugin(p);
    notify("已提交，自动检查完成后进入审核队列");
    setForm({ ...form, name: `${settings.scope}/`, title: "", description: "", file: "" });
  };

  return (
    <div>
      <PageHeader
        title="分享插件"
        desc={`把你写的 DSH 插件分享给同事。内部插件必须使用 ${settings.scope}/ 作用域，审核通过后出现在市场里。`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <Segmented
            value={way}
            onChange={setWay}
            options={[
              { value: "web", label: "网页上传" },
              { value: "cli", label: "命令行发布" },
              { value: "request", label: "申请引入社区插件" },
            ]}
          />
          <Card className="mt-4 p-6">
            {way === "cli" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">已按「接入指南」配置过 ~/.npmrc 的话，在插件目录直接发布：</p>
                <CopyBox text={`pnpm build\npnpm publish --registry ${settings.baseUrl}/npm/`} />
                <p className="text-sm text-slate-500">
                  发布后不会立即可装：包会先经过自动检查（dsh.bundle 声明、安装脚本、依赖漏洞、License、密钥泄露），再由管理员审核。
                  包名不在 {settings.scope}/ 下会被直接拒绝，防止与公网 npm 包重名导致依赖混淆。
                </p>
              </div>
            )}

            {way === "web" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    className={cx(
                      "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
                      form.file ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:border-brand-300",
                    )}
                  >
                    <UploadCloud size={28} className="text-brand-500" />
                    <span className="mt-2 text-sm font-medium text-slate-700">
                      {form.file || "选择 pnpm pack 打出的 .tgz 文件"}
                    </span>
                    <span className="mt-1 text-xs text-slate-400">包名与版本会从 package.json 自动读取</span>
                    <input
                      type="file"
                      accept=".tgz"
                      className="hidden"
                      onChange={(e) => setForm({ ...form, file: e.target.files?.[0]?.name ?? "" })}
                    />
                  </label>
                </div>
                <Field label="包名" hint={scopeOk ? undefined : <span className="text-red-500">必须以 {settings.scope}/ 开头</span>}>
                  <input className={cx(inputCls, "font-mono")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="版本">
                  <input className={cx(inputCls, "font-mono")} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                </Field>
                <Field label="显示名称">
                  <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：GitLab MR 评审助手" />
                </Field>
                <Field label="分类">
                  <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(categories).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="简介">
                    <textarea
                      className={cx(inputCls, "h-20 py-2")}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="可见范围">
                    <Segmented
                      value={form.visibility}
                      onChange={(v) => setForm({ ...form, visibility: v })}
                      options={[
                        { value: "company", label: "全公司" },
                        { value: "department", label: "仅本部门" },
                        { value: "private", label: "仅自己（测试）" },
                      ]}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Button disabled={!canSubmit} onClick={submit}>
                    提交审核
                  </Button>
                </div>
              </div>
            )}

            {way === "request" && <RequestForm />}
          </Card>
        </div>

        <Card className="h-fit">
          <div className="border-b border-slate-100 px-5 py-3 font-medium text-slate-800">我的提交</div>
          {mine.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">还没有提交过插件。</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mine.map((p) => (
                <li key={p.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    {p.status === "approved" ? (
                      <Link to={pluginPath(p.name)} className="font-medium text-slate-800 hover:text-brand-600">
                        {p.title}
                      </Link>
                    ) : (
                      <div className="font-medium text-slate-800">{p.title}</div>
                    )}
                    <div className="font-mono text-xs text-slate-400">
                      {p.name}@{p.version}
                    </div>
                  </div>
                  {statusBadge[p.status]}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function RequestForm() {
  const { notify } = useStore();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        在 dshfind.com 或 npm 上看到好用的插件、但企业市场里还没有？提交包名，管理员审核后会把它连同依赖一起同步进内网。
      </p>
      <Field label="npm 包名或 dshfind 链接">
        <input className={cx(inputCls, "font-mono")} value={name} onChange={(e) => setName(e.target.value)} placeholder="dsh-context" />
      </Field>
      <Field label="用途说明">
        <textarea className={cx(inputCls, "h-20 py-2")} placeholder="团队里打算怎么用它" />
      </Field>
      <Button
        disabled={!name.trim()}
        onClick={() => {
          notify(`已提交引入申请：${name}`);
          setName("");
        }}
      >
        提交申请
      </Button>
    </div>
  );
}
