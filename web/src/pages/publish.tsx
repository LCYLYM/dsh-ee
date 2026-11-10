import { useRef, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, UploadCloud, XCircle, PackageOpen } from "lucide-react";
import { useStore } from "../lib/store";
import { api, formatBytes, type PackageCheck } from "../lib/api";
import { ScanList } from "../components/scan-list";
import { useApi, useAction } from "../lib/use-api";
import { StatusBadge } from "../components/status";
import { pluginPath } from "../components/plugin-card";
import { LoadState } from "../components/api-ui";
import { Button, Card, CopyBox, cx, Field, inputCls, PageHeader, Segmented, Empty } from "../components/ui";
import { PageLink } from "../lib/menus";
import { Trans, useTranslation } from "react-i18next";

export default function Publish() {
  const { t } = useTranslation();
  const { settings, baseUrl } = useStore();
  const [way, setWay] = useState<"cli" | "web" | "request">("web");
  const mine = useApi(api.myPackages);
  const pkgJson = JSON.stringify(
    {
      name: `${settings.scope}/my-plugin`,
      version: "0.1.0",
      description: t("registry.publish.exampleDesc"),
      license: "MIT",
      dsh: { bundle: { patch: "cordis.patch.yml" } },
      "dsh-ee": { title: t("registry.publish.exampleTitle"), category: "tools", kind: "skill" },
    },
    null,
    2,
  );

  return (
    <div>
      <PageHeader title={t("publish.title")} desc={t("publish.desc", { scope: settings.scope })} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <Segmented
            value={way}
            onChange={setWay}
            options={[
              { value: "web", label: t("publish.web") },
              { value: "cli", label: t("publish.cli") },
              { value: "request", label: t("publish.request") },
            ]}
          />
          <Card className="mt-4 p-6">
            {way === "cli" && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-600">
                  <Trans i18nKey="registry.publish.cliDesc" components={{ link: <PageLink page="setup" className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200" /> }} />
                </p>
                <CopyBox label="~/.npmrc" text={`registry=${baseUrl}/npm/\n${baseUrl.replace(/^https?:/, "")}/npm/:_authToken=${t("registry.setup.tokenPlaceholder")}`} />
                <CopyBox text={`pnpm build\nnpm publish`} />
                <p className="text-sm text-neutral-500">{t("publish.cliNote", { scope: settings.scope })}</p>
              </div>
            )}
            {way === "web" && <Upload onDone={mine.reload} />}
            {way === "request" && <RequestForm />}
          </Card>
          <Card className="mt-4 p-6">
            <h2 className="mb-1 text-sm font-semibold text-neutral-800">{t("registry.publish.manifestTitle")}</h2>
            <p className="mb-3 text-sm text-neutral-600">{t("registry.publish.manifestDesc")}</p>
            <CopyBox label="package.json" text={pkgJson} />
          </Card>
        </div>

        <Card className="h-fit">
          <div className="border-b border-neutral-100 px-5 py-3 text-[15px] leading-6 font-semibold text-neutral-900">{t("publish.mine")}</div>
          <LoadState loading={mine.loading && !mine.data} error={mine.error} onRetry={mine.reload}>
            {(mine.data ?? []).length === 0 ? (
              <Empty compact icon={PackageOpen}>{t("publish.noneYet")}</Empty>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {(mine.data ?? []).map((p) => (
                  <li key={p.name} className="px-5 py-3 text-sm">
                    {p.status === "published" ? (
                      <Link to={pluginPath(p.name)} className="font-medium text-neutral-800 hover:text-brand-600 dark:hover:text-brand-200">
                        {p.title || p.name}
                      </Link>
                    ) : (
                      <div className="font-medium text-neutral-800">{p.title || p.name}</div>
                    )}
                    <ul className="mt-1.5 space-y-1">
                      {p.versions.slice(0, 5).map((v) => (
                        <li key={v.version} className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-neutral-500">
                              {p.name}@{v.version}
                            </div>
                            {v.review_note && <div className="text-xs text-neutral-600">{t("registry.publish.note", { note: v.review_note })}</div>}
                          </div>
                          <StatusBadge status={v.status} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </LoadState>
        </Card>
      </div>
    </div>
  );
}

function Upload({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { notify, reloadPlugins, reloadPending } = useStore();
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [tag, setTag] = useState("latest");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<PackageCheck | null>(null);
  const [result, setResult] = useState<{ name: string; version: string; status: string } | null>(null);
  // 预检期间换了文件时，丢掉旧响应，避免把 A 的结果显示在 B 上。
  const checkSeq = useRef(0);

  const preflight = async () => {
    if (!file) return;
    const seq = ++checkSeq.current;
    setChecking(true);
    try {
      const next = await api.checkPackage(file);
      if (seq === checkSeq.current) setCheck(next);
    } catch (error) {
      if (seq === checkSeq.current) notify(error instanceof Error ? error.message : String(error));
    } finally {
      if (seq === checkSeq.current) setChecking(false);
    }
  };

  const scanFailed = check?.scan.some((item) => item.level === "fail") ?? false;

  const submit = async () => {
    if (!file) return;
    const r = await run(() => api.uploadPackage(file, tag.trim() || undefined));
    if (!r.ok) return notify(r.error);
    setResult(r.value);
    setFile(null);
    setCheck(null);
    notify(r.value.status === "pending" ? t("publish.submitted") : t("registry.publish.publishedNow", { name: `${r.value.name}@${r.value.version}` }));
    onDone();
    reloadPlugins();
    reloadPending();
  };

  return (
    <div className="space-y-4">
      <label
        className={cx(
          "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
          file ? "border-brand-300 bg-brand-50" : "border-neutral-200 hover:border-brand-300",
        )}
      >
        <UploadCloud size={28} className="text-brand-500" />
        <span className="mt-2 text-sm font-medium text-neutral-700">{file ? `${file.name} · ${formatBytes(file.size)}` : t("publish.chooseFile")}</span>
        <span className="mt-1 text-xs text-neutral-500">{t("registry.publish.fileHint")}</span>
        <input
          type="file"
          accept=".tgz,application/gzip"
          className="hidden"
          onChange={(e) => {
            checkSeq.current++;
            setChecking(false);
            setFile(e.target.files?.[0] ?? null);
            setCheck(null);
            setResult(null);
          }}
        />
      </label>
      <Field label={t("registry.publish.tag")} hint={t("registry.publish.tagHint")}>
        <input className={cx(inputCls, "w-40 font-mono")} value={tag} onChange={(e) => setTag(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!file || busy || checking} onClick={preflight}>
          {checking ? t("publish.checking") : t("publish.check")}
        </Button>
        <Button disabled={!file || busy || checking || (check !== null && !check.can_submit)} onClick={submit}>
          {busy ? t("registry.publish.uploading") : t("publish.submit")}
        </Button>
      </div>
      {check && (
        <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50/60 p-4">
          <div className="flex items-start gap-2 text-sm">
            {!check.can_submit ? (
              <XCircle size={17} className="mt-0.5 shrink-0 text-red-500" />
            ) : scanFailed ? (
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-500" />
            ) : (
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />
            )}
            <div>
              <div className={check.can_submit ? "font-medium text-neutral-800" : "font-medium text-red-600"}>
                {!check.can_submit
                  ? t("publish.checkBlocked")
                  : check.will_publish
                    ? t("publish.checkPassed")
                    : t("publish.checkReview")}
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">{t("publish.checkHint")}</div>
              {check.can_submit && scanFailed && <div className="mt-1 text-xs text-amber-700">{t("publish.checkScanFail")}</div>}
            </div>
          </div>
          <ConflictList items={check.conflicts} />
          <ScanList items={check.scan} />
        </div>
      )}
      {result && (
        <p className="text-sm text-neutral-700">
          {result.status === "pending"
            ? t("registry.publish.resultPending", { name: `${result.name}@${result.version}` })
            : t("registry.publish.resultPublished", { name: `${result.name}@${result.version}` })}
        </p>
      )}
    </div>
  );
}

type DynT = (key: string, opts?: Record<string, unknown>) => string;

/** 预检发现的发布冲突；服务端只给 key 和参数，这里按当前语言渲染。 */
function ConflictList({ items }: { items: PackageCheck["conflicts"] }) {
  const { t: typed } = useTranslation();
  const t = typed as unknown as DynT;
  if (!items.length) return null;
  return (
    <ul className="space-y-1 text-sm text-red-600">
      {items.map((item, index) => (
        <li key={`${item.key}-${index}`}>{t(`publish.conflict.${item.key}`, { ...item.params, defaultValue: item.key })}</li>
      ))}
    </ul>
  );
}

function RequestForm() {
  const { t } = useTranslation();
  const { notify, reloadPending } = useStore();
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{t("publish.requestIntro")}</p>
      <Field label={t("publish.requestName")}>
        <input className={cx(inputCls, "font-mono")} value={name} onChange={(e) => setName(e.target.value)} placeholder="dsh-context" />
      </Field>
      <Field label={t("publish.requestReason")}>
        <textarea className={cx(inputCls, "h-20 py-2")} placeholder={t("publish.requestReasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button
        disabled={!name.trim() || busy}
        onClick={async () => {
          const r = await run(() => api.requestImport({ name: name.trim(), reason }));
          if (!r.ok) return notify(r.error);
          notify(t("publish.requestSent", { name: name.trim() }));
          setName("");
          setReason("");
          setTimeout(reloadPending, 3000);
        }}
      >
        {t("publish.requestSubmit")}
      </Button>
    </div>
  );
}
