import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type DemoImport } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, CopyBox } from "./ui";

/** 部署清单（/go）里「示例内容」一步：超级管理员一键导入知识库、连接、微应用与演示员工。 */
export function DemoImportStep({ done, onImported }: { done: boolean; onImported: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<DemoImport | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setAsking(false);
    setBusy(true);
    setError("");
    try {
      setResult(await api.importDemo());
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user?.is_super) return done ? null : <p className="mt-2 text-sm text-stone-500">{t("demo.superOnly")}</p>;
  return (
    <div className="mt-3 max-w-2xl text-sm">
      {result && (
        <ul className="flex flex-wrap gap-1.5">
          {result.items.map((it) => (
            <li key={`${it.kind}:${it.slug}`}>
              <Badge tone={it.result === "failed" ? "red" : "green"}>
                {t(`demo.kinds.${it.kind}`)} · {it.title}
                {it.result === "failed" && ` · ${t("demo.failed")}：${it.error}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {result && result.accounts.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-medium text-stone-900">{t("demo.accounts")}</p>
          <CopyBox wrap text={result.accounts.map((a) => `${a.display_name}（${a.department}）  ${a.username}  ${a.password}`).join("\n")} />
        </div>
      )}
      {result && <p className="mt-3 text-stone-500">{t("demo.tryIt")}</p>}
      {error && <p className="mt-3 text-red-600">{error}</p>}
      {!done && !result && !asking && (
        <Button size="sm" onClick={() => setAsking(true)} disabled={busy}>
          {busy ? t("demo.importing") : t("demo.import")}
        </Button>
      )}
      {asking && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-stone-800">{t("demo.confirm")}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void run()}>{t("demo.import")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
