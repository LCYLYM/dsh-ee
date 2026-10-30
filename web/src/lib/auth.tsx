import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, setUnauthorizedHandler, type Me } from "./api";

interface Auth {
  user: Me | null;
  /** 首次加载时正在确认会话。 */
  loading: boolean;
  /** 服务端连不上等非 401 错误。 */
  error: string | null;
  /** 本次没有用户是因为主动退出：登录后不回到上一个人的页面。 */
  loggedOut: boolean;
  login: (username: string, password: string) => Promise<Me>;
  /** 拥有任一权限点（超级管理员总是 true）；不传参数表示只要登录。 */
  can: (...codes: string[]) => boolean;
  /** 角色或权限被修改后重新拉取。 */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** 会话已在服务端失效（如修改密码后），只清本地状态。 */
  clear: () => void;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .me()
      .then(setUser)
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password);
    const u = await api.me();
    setUser(u);
    setError(null);
    setLoggedOut(false);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setLoggedOut(true);
      setUser(null);
    }
  }, []);

  const clear = useCallback(() => setUser(null), []);

  const can = useCallback(
    (...codes: string[]) => !!user && (user.is_super || codes.length === 0 || codes.some((c) => user.permissions.includes(c))),
    [user],
  );

  const refresh = useCallback(async () => {
    setUser(await api.me());
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, error, loggedOut, login, logout, clear, can, refresh }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth must be used inside AuthProvider");
  return a;
}

/** 未登录跳到登录页，登录后回到原地址。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, loggedOut } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">正在确认登录状态…</div>;
  }
  if (!user) {
    if (loggedOut) return <Navigate to="/login" replace />;
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}
