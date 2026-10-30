import { useState } from "react";
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
import { Trans, useTranslation } from "react-i18next";
import { PageLink } from "../../lib/menus";

const upstreamLabel: Record<Settings["upstream"]["registry"], string> = {
  npmmirror: "npmmirror",
  npmjs: "registry.npmjs.org",
  custom: "custom",
};

export default function AdminRegistry() {
  const { t } = useTranslation();
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
  const upstreamTarget = s.upstream.registry === "custom" ? s.upstream.customRegistry || t("registryAdmin.noAddress") : upstreamLabel[s.upstream.registry];

  const routes: { match: string; target: string; tone: "brand" | "amber" | "slate"; rule: string; scope?: string }[] = [
    ...scopes.map((sc, i) => ({
      match: `${sc}/*`,
      target: t("registryAdmin.hosted"),
      tone: "brand" as const,
      rule: t("registryAdmin.hostedRule"),
      scope: i === 0 ? undefined : sc,
    })),
    {
      match: "@deepseek-ai/dsh-*",
      target: t("registryAdmin.mirror"),
      tone: "slate",
      rule: core ? t("registryAdmin.mirrorRuleVersion", { version: core.version }) : t("registryAdmin.mirrorRule"),
    },
    {
      match: t("registryAdmin.everythingElse"),
      target: offline ? t("registryAdmin.noUpstream") : upstreamTarget,
      tone: offline ? "amber" : "slate",
      rule: offline
        ? t("registryAdmin.offlineRule")
        : s.registry.proxyMode === "cache"
          ? t("registryAdmin.cacheRule")
          : t("registryAdmin.preloadedRule"),
    },
  ];

  const addScope = () => {
    const v = newScope.trim();
    if (!/^@[a-z0-9][a-z0-9-._]*$/.test(v)) return notify(t("registryAdmin.scopeFormat"));
    if (scopes.includes(v)) return notify(t("registryAdmin.scopeExists", { scope: v }));
    setReg({ extraScopes: [...s.registry.extraScopes, v] });
    setNewScope("");
    notify(t("registryAdmin.scopeAdded", { scope: v }));
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
        title={t("registryAdmin.title")}
        desc={t("registryAdmin.desc", { url: registryUrl })}
        actions={
          <Button variant="secondary" size="sm" onClick={() => notify(t("registryAdmin.connectivityOk"))}>
            {t("registryAdmin.testConnectivity")}
          </Button>
        }
      />

      <StatStrip cols={3}>
        <Stat label={t("registryAdmin.hostedPackages")} value={hosted.length} hint={scopes.join(", ")} />
        <Stat label={t("registryAdmin.cachedPackages")} value={cachedPkgs.toLocaleString()} hint={t("registryAdmin.cachedHint", { count: cached.length })} />
        <Stat label={t("registryAdmin.storage")} value={formatKb(storage)} hint={t("registryAdmin.storageHint")} />
      </StatStrip>

      <Card className="mt-4">
        <CardHeader title={t("registryAdmin.routes")} aside={t("registryAdmin.routesOrder")} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colPackage")}</th>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colTarget")}</th>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colRule")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.match} className="border-t border-neutral-100">
                  <td className="px-5 py-3 font-mono whitespace-nowrap text-neutral-900">{r.match}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <Badge tone={r.tone}>{r.target}</Badge>
                  </td>
                  <td className="px-5 py-3 text-neutral-700">{r.rule}</td>
                  <td className="px-5 py-3 text-right">
                    {r.scope && (
                      <button
                        type="button"
                        className="text-sm text-neutral-600 hover:text-red-700"
                        onClick={() => setReg({ extraScopes: s.registry.extraScopes.filter((x) => x !== r.scope) })}
                      >
                        {t("registryAdmin.remove")}
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
            aria-label={t("registryAdmin.newScope")}
            className={cx(inputBase, "w-48 font-mono")}
            placeholder="@acme-data"
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addScope()}
          />
          <Button variant="secondary" size="sm" onClick={addScope}>
            {t("registryAdmin.addScope")}
          </Button>
          <span className="text-sm text-neutral-600">{t("registryAdmin.mainScope", { scope: s.scope })}</span>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-medium text-neutral-900">{t("registryAdmin.upstream")}</h2>
          <div className="mt-4 space-y-5">
            <Field label={t("registryAdmin.npmUpstream")} hint={offline ? t("registryAdmin.offlineHint") : undefined}>
              <div className="flex flex-col gap-2">
                <select
                  className={cx(inputBase, "w-56")}
                  value={s.upstream.registry}
                  disabled={offline}
                  onChange={(e) => setUp({ registry: e.target.value as Settings["upstream"]["registry"] })}
                >
                  <option value="npmmirror">{t("registryAdmin.npmmirror")}</option>
                  <option value="npmjs">registry.npmjs.org</option>
                  <option value="custom">{t("registryAdmin.customNexus")}</option>
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
              label={t("registryAdmin.outsideScope")}
              hint={
                s.registry.proxyMode === "cache"
                  ? t("registryAdmin.cacheHint")
                  : t("registryAdmin.preloadedHint")
              }
            >
              <Segmented
                value={s.registry.proxyMode}
                onChange={(v) => setReg({ proxyMode: v })}
                options={[
                  { value: "preloaded", label: t("registryAdmin.preloadedOnly") },
                  { value: "cache", label: t("registryAdmin.cacheOnDemand") },
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-medium text-neutral-900">{t("registryAdmin.clientConfig")}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            <Trans i18nKey="registryAdmin.clientConfigDesc" components={{ link: <PageLink page="setup" className="mx-1 font-medium text-neutral-900 hover:underline" /> }} />
          </p>
          <div className="mt-4">
            <CopyBox label="~/.npmrc" text={npmrc} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t("registryAdmin.tokens")} aside={t("registryAdmin.tokensCount", { count: tokens.length })} />
        <div className="flex items-start justify-between gap-6 px-5 pb-4">
          <div>
            <div className="text-sm text-neutral-900">{t("registryAdmin.requireToken")}</div>
            <div className="mt-0.5 text-sm text-neutral-600">
              {t("registryAdmin.requireTokenHint")}
            </div>
          </div>
          <Toggle checked={s.registry.requireToken} onChange={(v) => setReg({ requireToken: v })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colName")}</th>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colOwner")}</th>
                <th className="px-5 py-2 font-normal">{t("registryAdmin.colAccess")}</th>
                <th className="px-5 py-2 text-right font-normal">{t("registryAdmin.colCreated")}</th>
                <th className="px-5 py-2 text-right font-normal">{t("registryAdmin.colLastUsed")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((tk) => (
                <tr key={tk.id} className="border-t border-neutral-100">
                  <td className="px-5 py-3 text-neutral-900">{tk.name}</td>
                  <td className="px-5 py-3 text-neutral-700">{tk.owner}</td>
                  <td className="px-5 py-3">
                    <Badge tone={tk.access === "publish" ? "amber" : "slate"}>{tk.access === "publish" ? t("registryAdmin.readPublish") : t("registryAdmin.readOnly")}</Badge>
                  </td>
                  <td className="px-5 py-3 text-right text-neutral-700 tabular-nums">{tk.createdAt}</td>
                  <td className="px-5 py-3 text-right text-neutral-700 tabular-nums">{tk.lastUsed}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      className="text-sm text-neutral-600 hover:text-red-700"
                      onClick={() => {
                        revokeToken(tk.id);
                        notify(t("registryAdmin.tokenRevoked", { name: tk.name }));
                      }}
                    >
                      {t("registryAdmin.revoke")}
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
              aria-label={t("registryAdmin.tokenName")}
              className={cx(inputBase, "w-56")}
              placeholder={t("registryAdmin.tokenNamePlaceholder")}
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
            />
            <Segmented
              value={tokenAccess}
              onChange={setTokenAccess}
              options={[
                { value: "read", label: t("registryAdmin.readOnly") },
                { value: "publish", label: t("registryAdmin.readPublish") },
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
              {t("registryAdmin.newToken")}
            </Button>
          </div>
          {issued && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-neutral-700">{t("registryAdmin.tokenOnce")}</p>
              <CopyBox text={issued} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
