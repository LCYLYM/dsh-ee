import { useState } from "react";
import { Link } from "react-router";
import { Apple, Download, Monitor, ShieldCheck, Terminal } from "lucide-react";
import { useStore } from "../lib/store";
import type { Artifact, DshRelease } from "../lib/types";
import { Badge, Button, Card, CopyBox, cx, PageHeader, Segmented } from "../components/ui";
import { PageLink } from "../lib/menus";

const osLabel: Record<Artifact["os"], string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

function detectOs(): Artifact["os"] {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  return "linux";
}

function OsIcon({ os }: { os: Artifact["os"] }) {
  if (os === "macos") return <Apple size={18} />;
  if (os === "windows") return <Monitor size={18} />;
  return <Terminal size={18} />;
}

const channelBadge = (c: DshRelease["channel"]) =>
  c === "stable" ? <Badge tone="green">稳定版</Badge> : c === "alpha" ? <Badge tone="amber">预览版</Badge> : <Badge>旧版</Badge>;

function ArtifactList({ r, os }: { r: DshRelease; os: Artifact["os"] }) {
  const { notify, settings } = useStore();
  const sorted = [...r.artifacts].sort((a, b) => Number(b.os === os) - Number(a.os === os));
  return (
    <div className="divide-y divide-neutral-100">
      {sorted.map((a) => (
        <div key={a.file} className={cx("flex items-center gap-4 px-5 py-3", a.os === os && "bg-brand-50/50")}>
          <span className="text-neutral-500">
            <OsIcon os={a.os} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-neutral-800">
              {osLabel[a.os]} · {a.arch}
              {a.os === os && <span className="ml-2 text-xs font-normal text-brand-600">你的系统</span>}
            </div>
            <div className="truncate font-mono text-xs text-neutral-500" title={`sha256 ${a.sha256}`}>
              {a.file} · {a.sizeMb} MB · sha256 {a.sha256.slice(0, 16)}…
            </div>
          </div>
          <Button
            size="sm"
            variant={a.os === os ? "primary" : "secondary"}
            onClick={() => notify(`开始下载 ${settings.baseUrl}/dl/${a.file}（原型）`)}
          >
            <Download size={14} /> 下载
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function DshDownload() {
  const { releases, settings } = useStore();
  const [product, setProduct] = useState<DshRelease["product"]>("core");
  const os = detectOs();

  const available = releases.filter(
    (r) =>
      r.mirrored &&
      r.product === product &&
      (settings.distribution.allowAlpha || r.channel !== "alpha") &&
      (settings.distribution.allowCommunityDesktop || !r.distro.includes("社区")),
  );
  const recommended = available.filter((r) => r.recommended);
  const others = available.filter((r) => !r.recommended);

  if (!settings.distribution.enabled) {
    return (
      <Card className="p-12 text-center text-sm text-neutral-500">管理员未开启 DSH 本体分发，请联系 IT 获取安装包。</Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="下载 DSH"
        desc="从企业内网下载 DeepSeek Harness 本体与桌面版。安装包由管理员从官方渠道同步并校验，企业推荐版与插件市场的兼容性检查一致。"
        actions={
          <Segmented
            value={product}
            onChange={setProduct}
            options={[
              { value: "core", label: "DSH 核心（CLI）" },
              { value: "desktop", label: "桌面版" },
            ]}
          />
        }
      />

      <div className="space-y-6">
        {recommended.map((r) => (
          <Card key={r.distro + r.version} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 bg-neutral-50 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-neutral-900">
                    {r.distro} {r.version}
                  </span>
                  <Badge tone="brand">企业推荐</Badge>
                  {channelBadge(r.channel)}
                </div>
                <div className="mt-0.5 text-sm text-neutral-500">
                  {r.releasedAt} 发布 · {r.notes}
                </div>
              </div>
            </div>
            <ArtifactList r={r} os={os} />
          </Card>
        ))}

        {recommended.length === 0 && (
          <Card className="p-8 text-center text-sm text-neutral-500">管理员还没有为这一项设置企业推荐版本。</Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-neutral-900">
              <Terminal size={17} /> 安装后接入企业插件源
            </h2>
            <p className="mb-3 text-sm text-neutral-500">一条命令写好插件索引源、内网 registry 与企业 CA 证书：</p>
            <CopyBox text={`curl -fsSL ${settings.baseUrl}/setup.sh | sh`} />
            <PageLink page="setup" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
              查看 Windows 与手动配置方式 →
            </PageLink>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-neutral-900">
              <ShieldCheck size={17} /> 校验安装包
            </h2>
            <p className="mb-3 text-sm text-neutral-500">安装包与官方发布的 sha256 一致才会被同步进内网。下载后可自行核对：</p>
            <CopyBox
              text={
                os === "windows"
                  ? "Get-FileHash .\\<文件名> -Algorithm SHA256"
                  : os === "macos"
                    ? "shasum -a 256 <文件名>"
                    : "sha256sum <文件名>"
              }
            />
          </Card>
        </div>

        {others.length > 0 && (
          <div>
            <h2 className="mb-3 font-semibold text-neutral-900">其他版本</h2>
            <div className="space-y-4">
              {others.map((r) => (
                <details key={r.distro + r.version} className="group rounded-xl border border-neutral-200 bg-white">
                  <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5">
                    <span className="font-medium text-neutral-800">
                      {r.distro} {r.version}
                    </span>
                    {channelBadge(r.channel)}
                    <span className="ml-auto text-sm text-neutral-500">{r.releasedAt}</span>
                  </summary>
                  <div className="border-t border-neutral-100">
                    <p className="px-5 pt-3 text-sm text-neutral-500">{r.notes}</p>
                    <ArtifactList r={r} os={os} />
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
