import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction } from "../lib/use-api";
import { ErrorNote } from "../components/api-ui";
import { Button, Card, Field, inputCls, PageHeader } from "../components/ui";

export default function Account() {
  const { user, logout, clear } = useAuth();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPw !== confirmPw) return setError("两次输入的新密码不一致");
    const r = await run(() => api.changePassword(oldPw, newPw));
    if (!r.ok) return setError(r.error);
    // 服务端已让所有会话失效，回登录页用新密码登录
    clear();
    navigate("/login?next=%2Faccount", { replace: true });
  };

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="账号"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void logout()}
          >
            退出登录
          </Button>
        }
      />
      <Card className="p-5">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <dt className="text-neutral-600">用户名</dt>
          <dd className="text-neutral-900">{user.username}</dd>
          <dt className="text-neutral-600">显示名</dt>
          <dd className="text-neutral-900">{user.display_name || "—"}</dd>
          <dt className="text-neutral-600">部门</dt>
          <dd className="text-neutral-900">{user.department || "—"}</dd>
          <dt className="text-neutral-600">角色</dt>
          <dd className="text-neutral-900">{user.role === "admin" ? "管理员" : "员工"}</dd>
        </dl>
      </Card>

      <Card className="mt-4 p-5">
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-base font-medium text-neutral-900">修改密码</h2>
          <Field label="当前密码">
            <input className={inputCls} type="password" autoComplete="current-password" required value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
          <Field label="新密码" hint="至少 10 个字符。修改后所有设备都需要重新登录。">
            <input className={inputCls} type="password" autoComplete="new-password" required value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          <Field label="再输入一次新密码">
            <input className={inputCls} type="password" autoComplete="new-password" required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy || !oldPw || !newPw}>
            {busy ? "提交中…" : "修改密码"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
