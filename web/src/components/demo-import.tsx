import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type DemoImport } from "../lib/api";
import { useApi } from "../lib/use-api";
import { Badge, Button, Card, CardHeader, CopyBox } from "./ui";

/** 概览页上的「示例内容」：超级管理员一键导入知识库、连接、微应用与演示员工。 */
export function DemoImportCard() {
  const { t } = useTranslation();
  const status = useApi(api.demoStatus);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoImport | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const items = result?.items ?? status.data?.items ?? [];
  const done = items.filter(
    (it) => it.result === "created" || it.result === "exists",
  ).length;
  const imported = status.data?.imported && !result;

  const run = async () => {
    setAsking(false);
    setBusy(true);
    setError("");
    try {
      setResult(await api.importDemo());
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 导完就不再占着概览页；还没读到状态时也先不显示
  if (!status.data || imported) return null;

  return (
    <Card className="mb-4">
      <CardHeader
        title={t("demo.title")}
        aside={
          result ? (
            <Badge tone="green">{t("demo.imported")}</Badge>
          ) : done > 0 ? (
            <Badge tone="amber">{t("demo.partial")}</Badge>
          ) : undefined
        }
      />
      <div className="px-5 pb-5 text-sm">
        <p className="text-neutral-600">{t("demo.desc")}</p>
        {items.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {items.map((it) => (
              <li key={`${it.kind}:${it.slug}`}>
                <Badge
                  tone={
                    it.result === "failed"
                      ? "red"
                      : it.result === "missing"
                        ? "slate"
                        : "green"
                  }
                >
                  {t(`demo.kinds.${it.kind}`)} · {it.title}
                  {it.result === "failed" &&
                    ` · ${t("demo.failed")}：${it.error}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {result && result.accounts.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 font-medium text-neutral-900">
              {t("demo.accounts")}
            </p>
            <CopyBox
              wrap
              text={result.accounts
                .map(
                  (a) =>
                    `${a.display_name}（${a.department}）  ${a.username}  ${a.password}`,
                )
                .join("\n")}
            />
          </div>
        )}
        {result && <p className="mt-3 text-neutral-600">{t("demo.tryIt")}</p>}
        {error && <p className="mt-3 text-red-600">{error}</p>}
        {!result && !asking && (
          <Button
            className="mt-4"
            onClick={() => setAsking(true)}
            disabled={busy}
          >
            {busy ? t("demo.importing") : t("demo.import")}
          </Button>
        )}
        {asking && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-neutral-800">{t("demo.confirm")}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void run()}>
                {t("demo.import")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAsking(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
