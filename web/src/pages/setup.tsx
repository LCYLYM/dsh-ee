import { useState } from "react";
import { Info, KeyRound } from "lucide-react";
import { useStore } from "../lib/store";
import { Button, Card, CopyBox, PageHeader, Segmented } from "../components/ui";

type Mode = "unix" | "windows" | "manual";

export default function Setup() {
  const { settings, notify } = useStore();
  const [mode, setMode] = useState<Mode>("unix");
  const host = settings.baseUrl;
  const indexUrl = `${host}/market/dsh-index.json`;
  const registry = `${host}/npm/`;
  const registryKey = registry.replace(/^https?:/, "");

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="接入企业插件源"
        desc="接入后，DSH 的插件页会显示企业市场里的插件，安装时从内网下载，不需要访问外网。"
      />

      <Card className="mb-6 flex items-center gap-4 p-5">
        <KeyRound size={20} className="text-brand-500" />
        <div className="flex-1 text-sm">
          <div className="font-medium text-neutral-800">你的个人安装令牌</div>
          <div className="text-neutral-500">命令里已带上令牌，用于安装审计与按部门可见的插件。请勿外传。</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => notify("已重新生成令牌，旧令牌立即失效")}>
          重新生成
        </Button>
      </Card>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "unix", label: "macOS / Linux" },
          { value: "windows", label: "Windows" },
          { value: "manual", label: "手动配置" },
        ]}
      />

      <div className="mt-4 space-y-4">
        {mode === "unix" && (
          <>
            <CopyBox label="终端执行" text={`curl -fsSL ${host}/setup.sh | sh -s -- --token ee_tok_••••••••`} />
            <ScriptExplain />
          </>
        )}
        {mode === "windows" && (
          <>
            <CopyBox
              label="PowerShell 执行"
              text={`iwr ${host}/setup.ps1 -UseBasicParsing | iex; Setup-DshEE -Token ee_tok_••••••••`}
            />
            <ScriptExplain />
          </>
        )}
        {mode === "manual" && (
          <div className="space-y-5">
            <Step n={1} title="在 DSH 中添加插件索引源">
              <p className="mb-2 text-sm text-neutral-500">DSH 插件页 → Discover → 添加索引源，填入：</p>
              <CopyBox text={indexUrl} />
            </Step>
            <Step n={2} title="让 pnpm 从内网 registry 安装">
              <p className="mb-2 text-sm text-neutral-500">写入用户目录的 ~/.npmrc（Windows 为 %USERPROFILE%\.npmrc）：</p>
              <CopyBox
                text={`registry=${registry}\n${registryKey}:_authToken=ee_tok_••••••••\n${settings.scope}:registry=${registry}`}
              />
            </Step>
            <Step n={3} title="信任企业 CA 证书（内网使用自签证书时）">
              <p className="mb-2 text-sm text-neutral-500">下载证书后，让 DSH 与 pnpm 都信任它：</p>
              <CopyBox
                text={`curl -fsSLo ~/.dsh-ee-ca.pem ${host}/ca.pem\necho "cafile=$HOME/.dsh-ee-ca.pem" >> ~/.npmrc\nexport NODE_EXTRA_CA_CERTS=$HOME/.dsh-ee-ca.pem   # 写进 shell 配置文件`}
              />
            </Step>
            <Step n={4} title="验证">
              <CopyBox text={`dsh plugin add ${settings.scope}/dsh-feishu-notify`} />
            </Step>
          </div>
        )}
      </div>

      <Card className="mt-8 flex gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <Info size={18} className="mt-0.5 shrink-0" />
        <div>
          已经配置了 dshfind.com 等公网索引源也没关系，可以并存。若公司要求只用内部源，管理员会在网络层屏蔽公网 registry，
          此时公网源里的插件会安装失败。
        </div>
      </Card>
    </div>
  );
}

function ScriptExplain() {
  return (
    <Card className="p-5 text-sm text-neutral-600">
      <div className="mb-2 font-medium text-neutral-800">脚本会做这些事（可在执行前打开链接审阅）：</div>
      <ol className="list-decimal space-y-1 pl-5">
        <li>下载企业 CA 证书，配置 NODE_EXTRA_CA_CERTS 与 pnpm cafile</li>
        <li>在 ~/.npmrc 写入内网 registry 地址与你的安装令牌</li>
        <li>在 DSH 中添加企业插件索引源</li>
        <li>执行一次连通性检查并输出结果</li>
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
