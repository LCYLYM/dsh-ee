import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { WhaleMark } from "../components/whale-mark";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useApi } from "../lib/use-api";
import { Button, inputCls, PasswordInput } from "../components/ui";
import { LangSwitch } from "../components/lang-switch";
import { ThemeToggle } from "../components/theme-toggle";
import { useTranslation } from "react-i18next";

/** 只允许站内相对路径，防止 next 参数被拿来做开放重定向。 */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/go";
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
  const sso = methods.data?.oidc ?? null;
  // 企业统一登录失败时，回调把原因放在 oidc_error 里带回来
  const ssoError = params.get("oidc_error");
  // 从 DSH 自动登录的会话只带员工权限：带 reauth=1 进来时照常显示登录表单
  const reauth = params.get("reauth") === "1" && !!user?.limited;
  const handoffExpired = params.get("handoff") === "expired";
  useEffect(() => {
    if (reauth && user) setUsername((current) => current || user.username);
  }, [reauth, user]);

  if (!loading && user && !reauth) return <Navigate to={next} replace />;

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
        <WhaleMark size={36} className="text-brand-500" />
        <span className="text-lg font-semibold text-neutral-900">dsh-ee</span>
      </Link>
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-neutral-200/80 bg-card p-6">
        <h1 className="text-xl font-semibold text-neutral-900">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{ldap ? t("login.ldapHint") : t("login.subtitle")}</p>
        {(reauth || handoffExpired) && (
          <p role="status" className="mt-4 rounded-md bg-brand-50 px-3 py-2 text-sm text-neutral-800">
            {t(reauth ? "login.reauth" : "login.handoffExpired")}
          </p>
        )}
        {sso && (
          <>
            <a
              href={`/api/auth/oidc/start?next=${encodeURIComponent(next)}`}
              className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-brand-500 text-sm font-semibold text-white shadow-card hover:bg-brand-600"
            >
              {t("ssoLogin.button", { name: sso.name })}
            </a>
            <div className="mt-5 flex items-center gap-3 text-xs text-neutral-500">
              <span className="h-px flex-1 bg-neutral-200" />
              {t("ssoLogin.or")}
              <span className="h-px flex-1 bg-neutral-200" />
            </div>
          </>
        )}
        <div className={sso ? "mt-4 space-y-4" : "mt-6 space-y-4"}>
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
            <PasswordInput
              label={t("login.password")}
              className={inputCls}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        {(error ?? bootError ?? ssoError) && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-300">
            {error ?? bootError ?? t("ssoLogin.failed", { error: ssoError })}
          </p>
        )}
        <Button type="submit" variant={sso ? "secondary" : "primary"} className="mt-6 w-full" disabled={busy || !username || !password}>
          {busy ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
      <p className="mt-6 text-xs text-neutral-500">{ldap ? t("login.ldapForgot") : t("login.forgot")}</p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <LangSwitch />
        <ThemeToggle />
      </div>
    </div>
  );
}
