import { useState } from "react";
import { Link } from "react-router";
import { useStore } from "../../lib/store";
import type { RegistryToken, Settings } from "../../lib/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CopyBox,
  cx,
  Field,
  formatKb,
  inputBase,
  inputCls,
  PageHeader,
  Segmented,
  Stat,
  StatStrip,
  Toggle,
} from "../../components/ui";

const upstreamLabel: Record<Settings["upstream"]["registry"], string> = {
  npmmirror: "npmmirror",
  npmjs: "registry.npmjs.org",
  custom: "自定义上游",
};

export default function AdminRegistry() {
  const { settings: s, updateSettings, plugins, releases, tokens, createToken, revokeToken, notify } = useStore();
  const [newScope, setNewScope] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenAccess, setTokenAccess] = useState<RegistryToken["access"]>("read");
  const [issued, setIssued] = useState<string | null>(null);

  const setReg = (patch: Partial<Settings["registry"]>) => updateSettings((c) => ({ ...c, registry: { ...c.registry, ...patch } }));
  const setUp = (patch: Partial<Settings["upstream"]>) => updateSettings((c) => ({ ...c, upstream: { ...c.upstream, ...patch } }));

  const registryUrl = `${s.baseUrl}/npm/`;
  const scopes = [s.scope, ...s.registry.extraScopes];
  const approved = plugins.filter((p) => p.status === "approved");
  const hosted = approved.filter((p) => p.origin === "internal");
  const cached = approved.filter((p) => p.origin === "upstream");
  const cachedPkgs = cached.reduce((a, p) => a + 1 + p.depCount, 0);
  const storage = approved.reduce((a, p) => a + p.sizeKb, 0);
  const core = releases.find((r) => r.product === "core" && r.recommended);
  const offline = s.upstream.mode === "offline";
  const upstreamTarget = s.upstream.registry === "custom" ? s.upstream.customRegistry || "未填写地址" : upstreamLabel[s.upstream.registry];

  const routes: { match: string; target: string; rule: string; scope?: string }[] = [
    ...scopes.map((sc, i) => ({
      match: `${sc}/*`,
      target: "内部托管",
      rule: "只接受企业内发布，永不回源公网，防依赖混淆",
      scope: i === 0 ? undefined : sc,
    })),
    {
      match: "@deepseek-ai/dsh-*",
      target: "镜像",
      rule: `DSH 核心包，跟随企业推荐版本${core ? ` ${core.version}` : ""}同步`,
    },
    {
      match: "其它所有包",
      target: offline ? "不回源" : upstreamTarget,
      rule: offline
        ? "隔离网：只提供离线导入的包"
        : s.registry.proxyMode === "cache"
          ? "按需回源并缓存；首次安装需要外网"
          : "只提供已预载、已审核插件的依赖闭包",
    },
  ];

  const addScope = () => {
    const v = newScope.trim();
    if (!/^@[a-z0-9][a-z0-9-._]*$/.test(v)) return notify("作用域格式应为 @名称，例如 @acme-data");
    if (scopes.includes(v)) return notify(`${v} 已存在`);
    setReg({ extraScopes: [...s.registry.extraScopes, v] });
    setNewScope("");
    notify(`已添加内部作用域 ${v}`);
  };

  const npmrc = [
    `registry=${registryUrl}`,
    ...scopes.map((sc) => `${sc}:registry=${registryUrl}`),
    `${registryUrl.replace(/^https?:/, "")}:_authToken=\${DSH_EE_TOKEN}`,
    "cafile=~/.dsh-ee-ca.pem",
  ].join("\n");

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="npm 源"
        desc={`DSH 安装插件时实际下载的地方：${registryUrl}。企业作用域内部托管，其余按下面的规则处理。`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => notify("连通性正常：registry、上游与索引均可访问（原型）")}>
            测试连通性
          </Button>
        }
      />

      <StatStrip cols={3}>
        <Stat label="内部托管的包" value={hosted.length} hint={scopes.join("、")} />
        <Stat label="已缓存的上游包" value={cachedPkgs.toLocaleString()} hint={`${cached.length} 个插件及其依赖闭包`} />
        <Stat label="占用存储" value={formatKb(storage)} hint="不含 DSH 安装包" />
      </StatStrip>

      <Card className="mt-4">
        <CardHeader title="路由规则" aside="自上而下匹配" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="px-5 py-2 font-normal">包名</th>
                <th className="px-5 py-2 font-normal">去向</th>
                <th className="px-5 py-2 font-normal">说明</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.match} className="border-t border-neutral-100">
                  <td className="px-5 py-3 font-mono whitespace-nowrap text-neutral-900">{r.match}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <Badge tone={r.target === "内部托管" ? "brand" : r.target === "不回源" ? "amber" : "slate"}>{r.target}</Badge>
                  </td>
                  <td className="px-5 py-3 text-neutral-700">{r.rule}</td>
                  <td className="px-5 py-3 text-right">
                    {r.scope && (
                      <button
                        type="button"
                        className="text-sm text-neutral-600 hover:text-red-700"
                        onClick={() => setReg({ extraScopes: s.registry.extraScopes.filter((x) => x !== r.scope) })}
                      >
                        移除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-4">
          <input
            aria-label="新增内部作用域"
            className={cx(inputBase, "w-48 font-mono")}
            placeholder="@acme-data"
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addScope()}
          />
          <Button variant="secondary" size="sm" onClick={addScope}>
            添加内部作用域
          </Button>
          <span className="text-sm text-neutral-600">主作用域 {s.scope} 在系统设置的基本信息里修改。</span>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-medium text-neutral-900">上游</h2>
          <div className="mt-4 space-y-5">
            <Field label="npm 上游源" hint={offline ? "当前为隔离网，网络环境在「系统设置 → 上游」中切换。" : undefined}>
              <div className="flex flex-col gap-2">
                <select
                  className={cx(inputBase, "w-56")}
                  value={s.upstream.registry}
                  disabled={offline}
                  onChange={(e) => setUp({ registry: e.target.value as Settings["upstream"]["registry"] })}
                >
                  <option value="npmmirror">npmmirror（国内）</option>
                  <option value="npmjs">registry.npmjs.org</option>
                  <option value="custom">自定义（如企业 Nexus）</option>
                </select>
                {s.upstream.registry === "custom" && (
                  <input
                    className={cx(inputCls, "font-mono")}
                    placeholder="https://nexus.acme.internal/repository/npm/"
                    value={s.upstream.customRegistry}
                    disabled={offline}
                    onChange={(e) => setUp({ customRegistry: e.target.value })}
                  />
                )}
              </div>
            </Field>
            <Field
              label="企业作用域以外的包"
              hint={
                s.registry.proxyMode === "cache"
                  ? "员工装到没预载的包时，registry 去上游取并缓存。放行模式为白名单时，插件本身仍需审核。"
                  : "registry 不主动访问上游，员工只能装已预载插件及其依赖，最可控。"
              }
            >
              <Segmented
                value={s.registry.proxyMode}
                onChange={(v) => setReg({ proxyMode: v })}
                options={[
                  { value: "preloaded", label: "只提供已预载的" },
                  { value: "cache", label: "按需回源并缓存" },
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-medium text-neutral-900">客户端配置</h2>
          <p className="mt-1 text-sm text-neutral-600">
            员工执行
            <Link to="/setup" className="mx-1 font-medium text-neutral-900 hover:underline">
              接入脚本
            </Link>
            时会自动写入 ~/.npmrc，内容如下；CI 等服务器可手动配置。
          </p>
          <div className="mt-4">
            <CopyBox label="~/.npmrc" text={npmrc} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="访问令牌" aside={`${tokens.length} 个服务令牌`} />
        <div className="flex items-start justify-between gap-6 px-5 pb-4">
          <div>
            <div className="text-sm text-neutral-900">安装也需要令牌</div>
            <div className="mt-0.5 text-sm text-neutral-600">
              开启后每次下载都能对应到人，部门可见范围才能生效；员工的个人令牌由接入脚本生成。
            </div>
          </div>
          <Toggle checked={s.registry.requireToken} onChange={(v) => setReg({ requireToken: v })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="px-5 py-2 font-normal">名称</th>
                <th className="px-5 py-2 font-normal">创建人</th>
                <th className="px-5 py-2 font-normal">权限</th>
                <th className="px-5 py-2 text-right font-normal">创建于</th>
                <th className="px-5 py-2 text-right font-normal">最近使用</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  <td className="px-5 py-3 text-neutral-900">{t.name}</td>
                  <td className="px-5 py-3 text-neutral-700">{t.owner}</td>
                  <td className="px-5 py-3">
                    <Badge tone={t.access === "publish" ? "amber" : "slate"}>{t.access === "publish" ? "读取 + 发布" : "只读"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-right text-neutral-700 tabular-nums">{t.createdAt}</td>
                  <td className="px-5 py-3 text-right text-neutral-700 tabular-nums">{t.lastUsed}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      className="text-sm text-neutral-600 hover:text-red-700"
                      onClick={() => {
                        revokeToken(t.id);
                        notify(`已吊销「${t.name}」，使用它的客户端会立即失败`);
                      }}
                    >
                      吊销
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-neutral-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="令牌名称"
              className={cx(inputBase, "w-56")}
              placeholder="令牌名称，例如 GitLab CI 发布"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
            />
            <Segmented
              value={tokenAccess}
              onChange={setTokenAccess}
              options={[
                { value: "read", label: "只读" },
                { value: "publish", label: "读取 + 发布" },
              ]}
            />
            <Button
              size="sm"
              disabled={!tokenName.trim()}
              onClick={() => {
                setIssued(createToken(tokenName.trim(), tokenAccess));
                setTokenName("");
              }}
            >
              新建令牌
            </Button>
          </div>
          {issued && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-neutral-700">令牌只显示这一次，请立即复制保存。</p>
              <CopyBox text={issued} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
