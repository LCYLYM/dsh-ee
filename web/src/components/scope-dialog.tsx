import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Delivery, type Scope } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi, useAction } from "../lib/use-api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { ScopeEditor } from "./scope-editor";
import { ErrorNote } from "./api-ui";
import { Button, Field, Segmented } from "./ui";

/** 按当前用户的权限加载范围编辑器的候选：角色、用户与已有部门。 */
export function useScopeOptions() {
  const { can } = useAuth();
  const canRoles = can("roles.manage", "users.manage");
  const canUsers = can("users.view", "users.manage", "quotas.manage", "keys.manage", "roles.manage");
  const roles = useApi(() => (canRoles ? api.roles() : Promise.resolve(null)));
  const users = useApi(() => (canUsers ? api.users() : Promise.resolve(null)));
  const departments = useMemo(
    () => [...new Set((users.data ?? []).map((u) => u.department).filter(Boolean))].sort(),
    [users.data],
  );
  const roleName = (id: number) => roles.data?.find((r) => r.id === id)?.name ?? `#${id}`;
  return { roles: roles.data, users: users.data, departments, roleName };
}

/** 可用范围与下发方式的对话框；canDelivery 为假时只能改范围。 */
export function ScopeDialog({
  open,
  onOpenChange,
  title,
  description,
  scope,
  delivery,
  canDelivery,
  labels,
  onSave,
  selfId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  scope: Scope;
  delivery: Delivery;
  canDelivery: boolean;
  labels: { auto: string; optional: string; autoHint: string; optionalHint: string };
  onSave: (scope: Scope, delivery: Delivery) => Promise<void>;
  /** 负责人自己：多一个「只有我自己」，并说明扩大范围要审核。 */
  selfId?: number;
}) {
  const { t } = useTranslation();
  const opts = useScopeOptions();
  const [s, setS] = useState(scope);
  const [d, setD] = useState(delivery);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setS(scope);
      setD(delivery);
      setError(null);
    }
  }, [open, scope, delivery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-5">
          <Field label={t("editor.scope")}>
            <ScopeEditor value={s} onChange={setS} roles={opts.roles} users={opts.users} departments={opts.departments} selfId={selfId} />
          </Field>
          <Field label={t("editor.delivery")} hint={canDelivery ? (d === "auto" ? labels.autoHint : labels.optionalHint) : t("editor.deliveryAutoNeedsAdmin")}>
            <div className={canDelivery ? "" : "pointer-events-none opacity-50"}>
              <Segmented
                value={d}
                onChange={setD}
                options={[
                  { value: "optional", label: labels.optional },
                  { value: "auto", label: labels.auto },
                ]}
              />
            </div>
          </Field>
          <ErrorNote>{error}</ErrorNote>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run(() => onSave(s, d));
              if (r.ok) onOpenChange(false);
              else setError(r.error);
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
