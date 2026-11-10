/**
 * 通用数据表（TanStack Table v9）：表头点击排序、关键字搜索、分页，可在某行下方展开编辑区。
 * 样式沿用项目原有表格：灰色小号表头、行间细线、数字右对齐。
 *
 * 列定义用 columnHelper<行类型>() 写；搜索在交给表格前完成（searchText 返回参与搜索的文字）。
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox, SearchX } from "lucide-react";
import { cx, inputBase, Empty } from "./ui";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic, datetime: sortFn_datetime },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

type Features = typeof features;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataColumn<T extends RowData> = ColumnDef<Features, T, any>;
export const columnHelper = <T extends RowData>() => createColumnHelper<Features, T>();

const PAGE_SIZES = [10, 20, 50, 100];

export function DataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  searchText,
  searchPlaceholder,
  toolbar,
  renderExpanded,
  rowClassName,
  alignRight = [],
  hideOnMobile = [],
  emptyText,
  noMatchText,
  initialSorting = [],
  pageSize = 20,
}: {
  data: T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  /** 提供时显示搜索框：返回参与搜索的文字（不区分大小写）。 */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** 搜索框右侧的其它筛选控件。 */
  toolbar?: ReactNode;
  /** 返回非空时在该行下方展开整行内容（例如行内编辑器）。 */
  renderExpanded?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | false | undefined;
  /** 右对齐的列 id（数字列）。 */
  alignRight?: string[];
  /** 窄屏隐藏的列 id。 */
  hideOnMobile?: string[];
  /** 整个表一行数据都没有时的文案。 */
  emptyText: string;
  /** 有数据但被搜索 / 筛选掉时的文案。 */
  noMatchText?: string;
  initialSorting?: SortingState;
  pageSize?: number;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !searchText || !q ? data : data.filter((row) => searchText(row).toLowerCase().includes(q));
  }, [data, query, searchText]);

  const table = useTable({
    features,
    columns,
    data: filtered,
    getRowId: (row: T) => getRowId(row),
    state: { sorting, pagination },
    // 换了排序就回到第一页，否则看到的是新顺序里的某一页中间
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    // 数据刷新（例如保存后重新加载）时停在当前页
    autoResetPageIndex: false,
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));
  // 删除或筛选后当前页可能已经没有数据，退回最后一页
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1);
  if (pageIndex !== pagination.pageIndex) setPagination({ ...pagination, pageIndex });
  const from = total === 0 ? 0 : pageIndex * pagination.pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pagination.pageSize);
  const rows = table.getRowModel().rows;
  const right = (id: string) => alignRight.includes(id);
  const mobileHidden = (id: string) => (hideOnMobile.includes(id) ? "max-sm:hidden" : "");

  return (
    <div>
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          {searchText && (
            <input
              aria-label={searchPlaceholder ?? t("table.search")}
              className={cx(inputBase, "w-full sm:w-64")}
              placeholder={searchPlaceholder ?? t("table.search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
            />
          )}
          {toolbar}
        </div>
      )}

      {total === 0 ? (
        <Empty compact icon={data.length === 0 ? Inbox : SearchX}>{data.length === 0 ? emptyText : (noMatchText ?? emptyText)}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const id = h.column.id;
                      const sorted = h.column.getIsSorted();
                      const label = h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext());
                      return (
                        <th
                          key={h.id}
                          aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                          className={cx("px-5 py-2.5", right(id) && "text-right", mobileHidden(id))}
                        >
                          {h.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={h.column.getToggleSortingHandler()}
                              className={cx(
                                "inline-flex items-center gap-1 rounded font-semibold transition-colors hover:text-neutral-900",
                                right(id) && "flex-row-reverse",
                                sorted && "text-neutral-900",
                              )}
                            >
                              {label}
                              {sorted === "asc" ? (
                                <ArrowUp size={12} />
                              ) : sorted === "desc" ? (
                                <ArrowDown size={12} />
                              ) : (
                                <ArrowUpDown size={12} className="opacity-35" />
                              )}
                            </button>
                          ) : (
                            label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = renderExpanded?.(row.original);
                  return (
                    <Fragment key={row.id}>
                      <tr className={cx("border-t border-neutral-100 align-top", rowClassName?.(row.original))}>
                        {row.getAllCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={cx("px-5 py-3", right(cell.column.id) && "text-right tabular-nums", mobileHidden(cell.column.id))}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                      {expanded && (
                        <tr className="border-t border-neutral-100">
                          <td colSpan={columns.length} className="px-5 py-4">
                            {expanded}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200/80 px-5 py-2.5 text-[13px] text-neutral-600 dark:border-white/[0.07]">
            <span className="tabular-nums">{t("table.range", { from, to, total })}</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                {t("table.perPage")}
                <select
                  className={cx(inputBase, "h-8 w-20")}
                  value={pagination.pageSize}
                  onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t("table.prev")}
                  title={t("table.prev")}
                  disabled={pageIndex === 0}
                  onClick={() => setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageIndex - 1) }))}
                  className="rounded-md p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="tabular-nums">
                  {pageIndex + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  aria-label={t("table.next")}
                  title={t("table.next")}
                  disabled={pageIndex >= pageCount - 1}
                  onClick={() => setPagination((p) => ({ ...p, pageIndex: Math.min(pageCount - 1, pageIndex + 1) }))}
                  className="rounded-md p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
