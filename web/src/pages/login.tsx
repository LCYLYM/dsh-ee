import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Puzzle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useApi } from "../lib/use-api";
import { Button, inputCls } from "../components/ui";
import { LangSwitch } from "../components/lang-switch";
import { useTranslation } from "react-i18next";

/** 只允许站内相对路径，防止 next 参数被拿来做开放重定向。 */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/start";
}

export default function Login() {
  const { t } = useTranslation();
  const { user, loading, error: bootError, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const methods = useApi(api.authMethods);
  const ldap = !!methods.data?.ldap;

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <Link to="/" className="mb-8 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white">
          <Puzzle size={18} />
        </span>
        <span className="text-lg font-semibold text-neutral-900">dsh-ee</span>
      </Link>
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-neutral-200/80 bg-white p-6">
        <h1 className="text-xl font-semibold text-neutral-900">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{ldap ? t("login.ldapHint") : t("login.subtitle")}</p>
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-800">{t("login.username")}</span>
            <input
              className={inputCls}
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-800">{t("login.password")}</span>
            <input
              className={inputCls}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        {(error ?? bootError) && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error ?? bootError}
          </p>
        )}
        <Button type="submit" className="mt-6 w-full" disabled={busy || !username || !password}>
          {busy ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
      <p className="mt-6 text-xs text-neutral-500">{ldap ? t("login.ldapForgot") : t("login.forgot")}</p>
      <LangSwitch className="mt-3" />
    </div>
  );
}
