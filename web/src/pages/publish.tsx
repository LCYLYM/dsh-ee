import { useState } from "react";
import { Link } from "react-router";
import { UploadCloud } from "lucide-react";
import { categoryIds, categoryLabel } from "../mock/data";
import { useStore } from "../lib/store";
import type { Plugin, Visibility } from "../lib/types";
import { statusBadge } from "../components/status";
import { pluginPath } from "../components/plugin-card";
import { Button, Card, CopyBox, cx, Field, inputCls, PageHeader, Segmented } from "../components/ui";
import { useTranslation } from "react-i18next";

const ME = "zhang.wei";


export default function Publish() {
  const { t } = useTranslation();
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
    notify(t("publish.submitted"));
    setForm({ ...form, name: `${settings.scope}/`, title: "", description: "", file: "" });
  };

  return (
    <div>
      <PageHeader
        title={t("publish.title")}
        desc={t("publish.desc", { scope: settings.scope })}
      />
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
                <p className="text-sm text-neutral-600">{t("publish.cliDesc")}</p>
                <CopyBox text={`pnpm build\npnpm publish --registry ${settings.baseUrl}/npm/`} />
                <p className="text-sm text-neutral-500">
                  {t("publish.cliNote", { scope: settings.scope })}
                </p>
              </div>
            )}

            {way === "web" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label
                    className={cx(
                      "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
                      form.file ? "border-brand-300 bg-brand-50" : "border-neutral-200 hover:border-brand-300",
                    )}
                  >
                    <UploadCloud size={28} className="text-brand-500" />
                    <span className="mt-2 text-sm font-medium text-neutral-700">
                      {form.file || t("publish.chooseFile")}
                    </span>
                    <span className="mt-1 text-xs text-neutral-500">{t("publish.fileHint")}</span>
                    <input
                      type="file"
                      accept=".tgz"
                      className="hidden"
                      onChange={(e) => setForm({ ...form, file: e.target.files?.[0]?.name ?? "" })}
                    />
                  </label>
                </div>
                <Field label={t("publish.packageName")} hint={scopeOk ? undefined : <span className="text-red-500">{t("publish.mustStartWith", { scope: settings.scope })}</span>}>
                  <input className={cx(inputCls, "font-mono")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label={t("publish.version")}>
                  <input className={cx(inputCls, "font-mono")} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                </Field>
                <Field label={t("publish.displayName")}>
                  <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("publish.displayNamePlaceholder")} />
                </Field>
                <Field label={t("publish.category")}>
                  <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {categoryIds.map((id) => (
                      <option key={id} value={id}>
                        {categoryLabel(id)}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t("publish.summary")}>
                    <textarea
                      className={cx(inputCls, "h-20 py-2")}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={t("publish.visibility")}>
                    <Segmented
                      value={form.visibility}
                      onChange={(v) => setForm({ ...form, visibility: v })}
                      options={[
                        { value: "company", label: t("publish.visCompany") },
                        { value: "department", label: t("publish.visDepartment") },
                        { value: "private", label: t("publish.visPrivate") },
                      ]}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Button disabled={!canSubmit} onClick={submit}>
                    {t("publish.submit")}
                  </Button>
                </div>
              </div>
            )}

            {way === "request" && <RequestForm />}
          </Card>
        </div>

        <Card className="h-fit">
          <div className="border-b border-neutral-100 px-5 py-3 font-medium text-neutral-800">{t("publish.mine")}</div>
          {mine.length === 0 ? (
            <div className="p-5 text-sm text-neutral-500">{t("publish.noneYet")}</div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {mine.map((p) => (
                <li key={p.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    {p.status === "approved" ? (
                      <Link to={pluginPath(p.name)} className="font-medium text-neutral-800 hover:text-brand-600">
                        {p.title}
                      </Link>
                    ) : (
                      <div className="font-medium text-neutral-800">{p.title}</div>
                    )}
                    <div className="font-mono text-xs text-neutral-500">
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
  const { t } = useTranslation();
  const { notify } = useStore();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        {t("publish.requestIntro")}
      </p>
      <Field label={t("publish.requestName")}>
        <input className={cx(inputCls, "font-mono")} value={name} onChange={(e) => setName(e.target.value)} placeholder="dsh-context" />
      </Field>
      <Field label={t("publish.requestReason")}>
        <textarea className={cx(inputCls, "h-20 py-2")} placeholder={t("publish.requestReasonPlaceholder")} />
      </Field>
      <Button
        disabled={!name.trim()}
        onClick={() => {
          notify(t("publish.requestSent", { name }));
          setName("");
        }}
      >
        {t("publish.requestSubmit")}
      </Button>
    </div>
  );
}
