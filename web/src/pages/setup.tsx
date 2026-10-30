import { useState } from "react";
import { Info, KeyRound } from "lucide-react";
import { useStore } from "../lib/store";
import { Button, Card, CopyBox, PageHeader, Segmented } from "../components/ui";
import { useTranslation } from "react-i18next";

type Mode = "unix" | "windows" | "manual";

export default function Setup() {
  const { t } = useTranslation();
  const { settings, notify } = useStore();
  const [mode, setMode] = useState<Mode>("unix");
  const host = settings.baseUrl;
  const indexUrl = `${host}/market/dsh-index.json`;
  const registry = `${host}/npm/`;
  const registryKey = registry.replace(/^https?:/, "");

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t("setup.title")}
        desc={t("setup.desc")}
      />

      <Card className="mb-6 flex items-center gap-4 p-5">
        <KeyRound size={20} className="text-brand-500" />
        <div className="flex-1 text-sm">
          <div className="font-medium text-neutral-800">{t("setup.tokenTitle")}</div>
          <div className="text-neutral-500">{t("setup.tokenDesc")}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => notify(t("setup.regenerated"))}>
          {t("setup.regenerate")}
        </Button>
      </Card>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "unix", label: "macOS / Linux" },
          { value: "windows", label: "Windows" },
          { value: "manual", label: t("setup.manual") },
        ]}
      />

      <div className="mt-4 space-y-4">
        {mode === "unix" && (
          <>
            <CopyBox label={t("setup.runInTerminal")} text={`curl -fsSL ${host}/setup.sh | sh -s -- --token ee_tok_••••••••`} />
            <ScriptExplain />
          </>
        )}
        {mode === "windows" && (
          <>
            <CopyBox
              label={t("setup.runInPowerShell")}
              text={`iwr ${host}/setup.ps1 -UseBasicParsing | iex; Setup-DshEE -Token ee_tok_••••••••`}
            />
            <ScriptExplain />
          </>
        )}
        {mode === "manual" && (
          <div className="space-y-5">
            <Step n={1} title={t("setup.step1")}>
              <p className="mb-2 text-sm text-neutral-500">{t("setup.step1Desc")}</p>
              <CopyBox text={indexUrl} />
            </Step>
            <Step n={2} title={t("setup.step2")}>
              <p className="mb-2 text-sm text-neutral-500">{t("setup.step2Desc")}</p>
              <CopyBox
                text={`registry=${registry}\n${registryKey}:_authToken=ee_tok_••••••••\n${settings.scope}:registry=${registry}`}
              />
            </Step>
            <Step n={3} title={t("setup.step3")}>
              <p className="mb-2 text-sm text-neutral-500">{t("setup.step3Desc")}</p>
              <CopyBox
                text={`curl -fsSLo ~/.dsh-ee-ca.pem ${host}/ca.pem\necho "cafile=$HOME/.dsh-ee-ca.pem" >> ~/.npmrc\nexport NODE_EXTRA_CA_CERTS=$HOME/.dsh-ee-ca.pem   ${t("setup.shellComment")}`}
              />
            </Step>
            <Step n={4} title={t("setup.step4")}>
              <CopyBox text={`dsh plugin add ${settings.scope}/dsh-feishu-notify`} />
            </Step>
          </div>
        )}
      </div>

      <Card className="mt-8 flex gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <Info size={18} className="mt-0.5 shrink-0" />
        <div>
          {t("setup.coexist")}
        </div>
      </Card>
    </div>
  );
}

function ScriptExplain() {
  const { t } = useTranslation();
  return (
    <Card className="p-5 text-sm text-neutral-600">
      <div className="mb-2 font-medium text-neutral-800">{t("setup.scriptTitle")}</div>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t("setup.scriptCa")}</li>
        <li>{t("setup.scriptNpmrc")}</li>
        <li>{t("setup.scriptIndex")}</li>
        <li>{t("setup.scriptCheck")}</li>
      </ol>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-medium text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 font-medium text-neutral-800">{title}</div>
        {children}
      </div>
    </div>
  );
}
