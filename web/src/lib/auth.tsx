import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, setUnauthorizedHandler, type User } from "./api";

interface Auth {
  user: User | null;
  /** 首次加载时正在确认会话。 */
  loading: boolean;
  /** 服务端连不上等非 401 错误。 */
  error: string | null;
  /** 本次没有用户是因为主动退出：登录后不回到上一个人的页面。 */
  loggedOut: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** 会话已在服务端失效（如修改密码后），只清本地状态。 */
  clear: () => void;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
    const u = await api.login(username, password);
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

  return <Ctx.Provider value={{ user, loading, error, loggedOut, login, logout, clear }}>{children}</Ctx.Provider>;
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

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">需要管理员权限</h1>
        <p className="mt-2 text-sm text-neutral-600">这个页面只对管理员开放，如需访问请联系管理员。</p>
      </div>
    );
  }
  return children;
}
