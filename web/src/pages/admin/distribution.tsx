import { Link } from "react-router";
import { RefreshCw, Upload } from "lucide-react";
import { useStore } from "../../lib/store";
import type { DshRelease } from "../../lib/types";
import { Badge, Button, Card, PageHeader, Toggle } from "../../components/ui";

const channelBadge = (c: DshRelease["channel"]) =>
  c === "stable" ? <Badge tone="green">稳定版</Badge> : c === "alpha" ? <Badge tone="amber">预览版</Badge> : <Badge>旧版</Badge>;

function ReleaseTable({ product, title }: { product: DshRelease["product"]; title: string }) {
  const { releases, setRecommended, toggleMirrored, settings, notify } = useStore();
  const rows = releases.filter((r) => r.product === product);
  return (
    <Card>
      <div className="flex items-center border-b border-slate-100 px-5 py-3">
        <span className="font-medium text-slate-800">{title}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => notify("已检查官方渠道：发现 0.2.1-alpha.5，已加入同步队列（原型）")}>
            <RefreshCw size={14} /> 检查官方新版本
          </Button>
          <Button variant="secondary" size="sm" onClick={() => notify("上传自定义安装包（原型）")}>
            <Upload size={14} /> 上传安装包
          </Button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-400">
          <tr>
            <th className="px-5 py-2 font-normal">发行版 / 版本</th>
            <th className="px-5 py-2 font-normal">渠道</th>
            <th className="px-5 py-2 font-normal">发布日期</th>
            <th className="px-5 py-2 font-normal">平台</th>
            <th className="px-5 py-2 font-normal">已同步到内网</th>
            <th className="px-5 py-2 font-normal">企业推荐</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const hidden =
              (r.channel === "alpha" && !settings.distribution.allowAlpha) ||
              (r.distro.includes("社区") && !settings.distribution.allowCommunityDesktop);
            return (
              <tr key={r.distro + r.version}>
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-800">
                    {r.distro} <span className="font-mono">{r.version}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {r.notes}
                    {hidden && <span className="ml-1 text-amber-600">· 按当前设置员工看不到</span>}
                  </div>
                </td>
                <td className="px-5 py-3">{channelBadge(r.channel)}</td>
                <td className="px-5 py-3 text-slate-500">{r.releasedAt}</td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {r.artifacts.length} 个 · {(r.artifacts.reduce((a, x) => a + x.sizeMb, 0) / 1024).toFixed(2)} GB
                </td>
                <td className="px-5 py-3">
                  <Toggle checked={r.mirrored} onChange={() => toggleMirrored(r.distro, r.version)} />
                </td>
                <td className="px-5 py-3">
                  <input
                    type="radio"
                    name={`rec-${product}-${product === "desktop" ? r.distro : "core"}`}
                    checked={r.recommended}
                    disabled={!r.mirrored}
                    onChange={() => {
                      setRecommended(product, r.distro, r.version);
                      notify(`已将 ${r.distro} ${r.version} 设为企业推荐`);
                    }}
                    className="accent-brand-500"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export default function AdminDistribution() {
  const { settings } = useStore();
  return (
    <div>
      <PageHeader
        title="DSH 分发"
        desc="在内网分发 DSH 本体与桌面版。安装包从官方渠道同步并核对 sha256，企业推荐版本同时也是插件兼容性检查和 @deepseek-ai/dsh-* 核心包镜像的基准。"
      />
      {!settings.distribution.enabled && (
        <Card className="mb-6 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          DSH 分发当前已关闭，员工门户不显示下载入口。可在
          <Link to="/admin/settings" className="mx-1 underline">
            系统设置
          </Link>
          中开启。
        </Card>
      )}
      <div className="space-y-6">
        <ReleaseTable product="core" title="DSH 核心（CLI）" />
        <ReleaseTable product="desktop" title="桌面版" />
        <Card className="p-5 text-sm text-slate-600">
          <div className="mb-1 font-medium text-slate-800">企业预配置安装包（规划中）</div>
          把企业插件索引源、内网 registry 与 CA 证书预先写进安装包，员工装完就能直接用企业市场，不必再跑接入脚本。
          需要确认 DSH 是否支持安装时读取预置配置。
        </Card>
      </div>
    </div>
  );
}
