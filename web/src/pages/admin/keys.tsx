import { useMemo, useState, type FormEvent } from "react";
import { api, formatTime, keyState, type ApiKey } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, KeyStateBadge, LoadState, TokensCell } from "../../components/api-ui";
import { Button, Card, CardHeader, CopyBox, cx, Field, inputBase, inputCls, PageHeader, Segmented } from "../../components/ui";
import { useTranslation } from "react-i18next";
import { DataTable, columnHelper, type DataColumn } from "@/components/data-table";
import { useConfirm } from "@/lib/confirm";
import { Combobox, DatePicker } from "@/components/pickers";

type Filter = "active" | "all";

function IssueForm({ onIssued }: { onIssued: (plain: string, k: ApiKey) => void }) {
  const { t } = useTranslation();
  const users = useApi(api.users);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const activeUsers = (users.data ?? []).filter((u) => !u.disabled);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() =>
      api.issueKey({
        user_id: Number(userId),
        name: name.trim(),
        // 日期输入取当天结束（本地时间）
        ...(expires ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() } : {}),
      }),
    );
    if (!r.ok) return setError(r.error);
    setName("");
    setExpires("");
    onIssued(r.value.key, r.value.api_key);
  };

  if (users.loading) return <div className="px-5 pb-5 text-sm text-neutral-600">{t("common.loading")}</div>;
  if (users.error) return <div className="px-5 pb-5"><ErrorNote>{users.error}</ErrorNote></div>;

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <p className="text-sm text-neutral-700">{t("adminKeys.issueNote")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("adminKeys.employee")}>
          <Combobox
            value={userId}
            onChange={setUserId}
            placeholder={t("adminKeys.chooseEmployee")}
            options={activeUsers.map((u) => ({
              value: String(u.id),
              label: u.display_name ? `${u.display_name} (${u.username})` : u.username,
              hint: u.department || undefined,
            }))}
          />
        </Field>
        <Field label={t("adminKeys.name")} hint={t("adminKeys.nameHint")}>
          <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("adminKeys.expiry")} hint={t("adminKeys.expiryHint")}>
          <DatePicker value={expires} onChange={setExpires} futureOnly />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !userId || !name.trim()}>
        {busy ? t("common.creating") : t("adminKeys.issue")}
      </Button>
    </form>
  );
}

export default function AdminKeys() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { notify } = useStore();
  const { data: keys, error, loading, reload } = useApi(api.keys);
  const { busy, run } = useAction();
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ plain: string; k: ApiKey } | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const list = useMemo(() => (keys ?? []).filter((k) => filter === "all" || keyState(k) === "active"), [keys, filter]);
  const monthTotal = (keys ?? []).reduce((a, k) => a + k.month_tokens, 0);

  const revoke = async (k: ApiKey) => {
    if (!(await confirm({ kind: "revoke", description: t("adminKeys.revokeConfirm", { user: k.username, name: k.name }) }))) return;
    const r = await run(() => api.revokeKey(k.id));
    notify(r.ok ? t("adminKeys.revoked", { name: k.name }) : r.error);
    if (r.ok) reload();
  };

  const col = columnHelper<ApiKey>();
  const columns: DataColumn<ApiKey>[] = [
    col.accessor((k) => `${k.username} ${k.name}`, {
      id: "owner",
      header: () => t("adminKeys.colOwner"),
      cell: ({ row: { original: k } }) => (
        <>
          <div className="text-neutral-900">
            {k.username} · {k.name}
          </div>
          <div className="font-mono text-xs text-neutral-600">{k.prefix}…</div>
          <div className="text-xs text-neutral-600">
            {t("adminKeys.created", { time: formatTime(k.created_at) })}
            {k.expires_at ? t("adminKeys.expires", { time: formatTime(k.expires_at) }) : ""}
          </div>
        </>
      ),
    }),
    col.accessor((k) => k.month_tokens, { id: "usage", header: () => t("adminKeys.colUsage"), cell: (c) => <TokensCell tokens={c.getValue()} /> }),
    col.accessor((k) => k.last_used_at ?? "", { id: "lastUsed", header: () => t("adminKeys.colLastUsed"), cell: ({ row: { original: k } }) => formatTime(k.last_used_at) }),
    col.accessor((k) => keyState(k), { id: "status", header: () => t("adminKeys.colStatus"), cell: ({ row: { original: k } }) => <KeyStateBadge k={k} /> }),
    col.display({
      id: "actions",
      header: () => <span className="sr-only">{t("table.actions")}</span>,
      cell: ({ row: { original: k } }) =>
        keyState(k) === "active" ? (
          <div className="text-right">
            <button type="button" disabled={busy} onClick={() => revoke(k)} className="text-sm text-neutral-600 hover:text-red-700 disabled:opacity-50">
              {t("adminKeys.revoke")}
            </button>
          </div>
        ) : null,
    }),
  ];

  return (
    <div>
      <PageHeader
        title={t("pages.admin-keys")}
        desc={t("adminKeys.desc")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIssuing((v) => !v);
              setIssued(null);
            }}
          >
            {issuing ? t("common.close") : t("adminKeys.issue")}
          </Button>
        }
      />

      {issued && (
        <Card className="mb-4 p-5">
          <h2 className="text-base font-medium text-neutral-900">
            {t("adminKeys.issuedTitle", { user: issued.k.username, name: issued.k.name })}
          </h2>
          <p className="mt-1 mb-3 text-sm text-neutral-700">{t("adminKeys.issuedHint")}</p>
          <CopyBox text={issued.plain} />
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setIssued(null)}>
            {t("adminKeys.issuedClose")}
          </Button>
        </Card>
      )}

      {issuing && (
        <Card className="mb-4">
          <CardHeader title={t("adminKeys.issue")} />
          <IssueForm
            onIssued={(plain, k) => {
              setIssued({ plain, k });
              setIssuing(false);
              reload();
            }}
          />
        </Card>
      )}

      <Card>
        <CardHeader title={t("adminKeys.all")} aside={keys ? t("adminKeys.monthTotal", { tokens: monthTotal.toLocaleString() }) : undefined} />
        <LoadState loading={loading && !keys} error={error} onRetry={reload}>
          <DataTable
            data={list}
            getRowId={(k) => String(k.id)}
            columns={columns}
            searchText={(k) => `${k.username} ${k.name} ${k.prefix}`}
            searchPlaceholder={t("adminKeys.searchPlaceholder")}
            toolbar={
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "active", label: t("adminKeys.filterActive") },
                  { value: "all", label: t("adminKeys.filterAll") },
                ]}
              />
            }
            alignRight={["usage", "lastUsed"]}
            hideOnMobile={["lastUsed"]}
            emptyText={keys?.length ? t("adminKeys.noMatch") : t("adminKeys.none")}
            noMatchText={t("adminKeys.noMatch")}
            initialSorting={[{ id: "lastUsed", desc: true }]}
          />
        </LoadState>
      </Card>
    </div>
  );
}
