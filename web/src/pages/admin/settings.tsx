import type { ReactNode } from "react";
import { Link } from "react-router";
import { useStore } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { Button, Card, cx, Field, inputBase, inputCls, PageHeader, Segmented, Toggle } from "../../components/ui";
import { PageLink } from "../../lib/menus";

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="font-semibold text-neutral-900">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-neutral-500">{desc}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  );
}

function Row({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-6", disabled && "opacity-50")}>
      <div>
        <div className="text-sm font-medium text-neutral-800">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-neutral-500">{desc}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function AdminSettings() {
  const { settings: s, updateSettings, resetSettings, notify } = useStore();
  const set = <K extends keyof Settings>(key: K, patch: Partial<Settings[K]> | Settings[K]) =>
    updateSettings((cur) => ({
      ...cur,
      [key]: typeof patch === "object" && patch !== null ? { ...(cur[key] as object), ...patch } : patch,
    }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="系统设置"
        desc="修改即时生效（原型中保存在浏览器本地）。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              resetSettings();
              notify("已恢复默认设置");
            }}
          >
            恢复默认
          </Button>
        }
      />
      <div className="space-y-6">
        <Section title="基本信息">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="企业名称">
              <input className={inputCls} value={s.orgName} onChange={(e) => set("orgName", e.target.value)} />
            </Field>
            <Field label="访问地址">
              <input className={cx(inputCls, "font-mono")} value={s.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
            </Field>
          </div>
          <Field label="内部主作用域" hint="内部发布必须使用此作用域，且永不回源公网 npm。更多作用域与路由规则见「npm 源」。">
            <input className={cx(inputBase, "w-48 font-mono")} value={s.scope} onChange={(e) => set("scope", e.target.value)} />
          </Field>
        </Section>

        <Section title="评分" desc="关闭后，门户与后台不再显示任何评分，也不能按评分排序或用评分门槛挑选预载插件。">
          <Row
            label="启用评分"
            desc="总开关。有的企业不希望评分影响选择，或者内部插件不便公开打分。"
            checked={s.scoring.enabled}
            onChange={(v) => set("scoring", { enabled: v })}
          />
          <div className="space-y-5 border-l-2 border-neutral-100 pl-5">
            <Row
              label="显示 dshfind 上游评分"
              desc="来自 dshfind.com 的综合评分（0-100），只有上游插件有。"
              checked={s.scoring.showUpstreamScore}
              disabled={!s.scoring.enabled}
              onChange={(v) => set("scoring", { showUpstreamScore: v })}
            />
            <Row
              label="允许员工打分"
              desc="1-5 星，只在企业内可见。"
              checked={s.scoring.allowEmployeeRating}
              disabled={!s.scoring.enabled}
              onChange={(v) => set("scoring", { allowEmployeeRating: v })}
            />
            <div className={cx(!(s.scoring.enabled && s.scoring.showUpstreamScore) && "pointer-events-none opacity-50")}>
              <Field label={`预载默认最低评分：${s.scoring.minPreloadScore}`}>
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={s.scoring.minPreloadScore}
                  onChange={(e) => set("scoring", { minPreloadScore: +e.target.value })}
                  className="w-full accent-brand-500"
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="收录策略">
          <Field
            label="放行模式"
            hint={
              s.admissionMode === "allowlist"
                ? "员工只能安装审核通过的插件；上游新插件需先引入并审核。"
                : "registry 会按需回源上游，员工可安装任何社区插件；黑名单中的除外。"
            }
          >
            <Segmented
              value={s.admissionMode}
              onChange={(v) => set("admissionMode", v)}
              options={[
                { value: "allowlist", label: "白名单（推荐）" },
                { value: "open", label: "开放 + 黑名单" },
              ]}
            />
          </Field>
        </Section>

        <Section title="上游">
          <Field label="网络环境">
            <Segmented
              value={s.upstream.mode}
              onChange={(v) => set("upstream", { mode: v })}
              options={[
                { value: "online", label: "可联网（在线同步）" },
                { value: "offline", label: "隔离网（离线导入）" },
              ]}
            />
          </Field>
          <Row
            label="订阅 dshfind 插件目录"
            desc="获取收录、分类、评分、风险标记等元数据，用于挑选预载插件。"
            checked={s.upstream.dshfindFeed}
            disabled={s.upstream.mode === "offline"}
            onChange={(v) => set("upstream", { dshfindFeed: v })}
          />
          <p className="text-sm text-neutral-600">
            npm 上游源与回源策略在
            <PageLink page="admin-registry" className="mx-1 font-medium text-neutral-900 hover:underline">
              npm 源
            </PageLink>
            页设置。
          </p>
          <Field label="已入库插件出新版本时">
            <Segmented
              value={s.upstream.autoSync}
              onChange={(v) => set("upstream", { autoSync: v })}
              options={[
                { value: "review", label: "同步后审核" },
                { value: "auto", label: "自动上架" },
                { value: "off", label: "不同步" },
              ]}
            />
          </Field>
        </Section>

        <Section title="DSH 本体分发">
          <Row
            label="在门户提供 DSH 下载"
            desc="员工可从内网下载 DSH 核心与桌面版安装包。"
            checked={s.distribution.enabled}
            onChange={(v) => set("distribution", { enabled: v })}
          />
          <Row
            label="向员工展示预览版"
            desc="alpha / rc 版本。"
            checked={s.distribution.allowAlpha}
            disabled={!s.distribution.enabled}
            onChange={(v) => set("distribution", { allowAlpha: v })}
          />
          <Row
            label="允许分发社区桌面端"
            desc="除官方桌面版外，也分发审核过的社区桌面端。"
            checked={s.distribution.allowCommunityDesktop}
            disabled={!s.distribution.enabled}
            onChange={(v) => set("distribution", { allowCommunityDesktop: v })}
          />
        </Section>

        <Section title="登录与认证">
          <Segmented
            value={s.auth}
            onChange={(v) => set("auth", v)}
            options={[
              { value: "local", label: "本地账号" },
              { value: "ldap", label: "LDAP / AD" },
              { value: "oidc", label: "OIDC SSO" },
            ]}
          />
          <p className="text-xs text-neutral-500">网页登录走所选方式；pnpm 安装使用员工在「接入指南」页生成的个人令牌。</p>
        </Section>
      </div>
    </div>
  );
}
