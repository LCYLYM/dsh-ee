package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/datahub"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 示例公司的数据中台（M15）：从演示 CRM 导出「客户主数据」，从演示员工导出「人员」，再写三个数据集。
// 数据中台没开时跳过。清除时删表、删数据集（demo_records 里 kind 为 data_table / data_set，按 slug 认）。

type demoDataSet struct {
	Slug, Title, Description, SQL string
}

var demoDataSets = []demoDataSet{
	{"customers", "客户主数据（示例）", "星河科技全部客户：行业、城市、负责人、年合同额、续约日期与风险。来自 CRM 的每日导出。",
		"SELECT 客户编号 AS id, 客户 AS name, 行业 AS industry, 城市 AS city, 负责人 AS owner, 年合同额 AS arr, 续约日期 AS renew_at, 续约风险 AS risk FROM customers ORDER BY arr DESC"},
	{"my-customers", "我负责的客户（示例）", "当前员工负责的客户，按续约日期排。",
		"SELECT 客户编号 AS id, 客户 AS name, 年合同额 AS arr, 续约日期 AS renew_at, 续约风险 AS risk FROM customers WHERE 负责人 = :me_name ORDER BY renew_at"},
	{"dept-colleagues", "本部门同事（示例）", "当前员工所在部门的同事和职务。",
		"SELECT 姓名 AS name, 职务 AS title FROM staff WHERE 部门 = :me_department ORDER BY 姓名"},
}

// demoImportData 写入示例的表和数据集；返回导入结果（数据中台没开时为空）。
func (s *Server) demoImportData(ctx context.Context, by int64, now time.Time) []demoItem {
	if _, ok := s.dataReady(); !ok || s.opts.DataHub.ReadErr != "" {
		return nil
	}
	h := s.opts.DataHub
	var items []demoItem
	table := func(name, title, desc string, cols []datahub.Column, rows [][]any, ref int64) {
		it := demoItem{Kind: "data_table", Slug: name, Title: title, Result: "exists"}
		if _, err := s.store.GetDataTable(ctx, name); err == nil {
			items = append(items, it)
			return
		}
		err := h.ReplaceTable(ctx, name, cols, rows)
		if err == nil {
			t := &store.DataTable{Name: name, Title: title, Description: desc, RowCount: int64(len(rows))}
			for _, c := range cols {
				t.Columns = append(t.Columns, store.DataColumn{Name: c.Name, Type: c.Type})
			}
			if err = s.store.SaveDataTable(ctx, t, by); err == nil {
				err = s.store.RecordDemo(ctx, "data_table", ref, name)
			}
		}
		if err != nil {
			it.Result, it.Error = "failed", err.Error()
		} else {
			it.Result = "created"
		}
		items = append(items, it)
	}
	var customers [][]any
	for _, c := range demoCRMCustomers(now) {
		customers = append(customers, []any{c.ID, c.Name, c.Industry, c.City, c.Owner, c.ARR, c.Stage, c.RenewAt, float64(c.Health), c.Risk})
	}
	table("customers", "客户主数据（示例）", "从演示 CRM 导出的 50 个客户", []datahub.Column{
		{Name: "客户编号", Type: "text"}, {Name: "客户", Type: "text"}, {Name: "行业", Type: "text"}, {Name: "城市", Type: "text"}, {Name: "负责人", Type: "text"},
		{Name: "年合同额", Type: "number"}, {Name: "阶段", Type: "text"}, {Name: "续约日期", Type: "date"}, {Name: "健康度", Type: "number"}, {Name: "续约风险", Type: "text"},
	}, customers, 1)
	var staff [][]any
	for _, u := range demoUsers {
		staff = append(staff, []any{u.Username, u.DisplayName, u.Department, u.Title})
	}
	table("staff", "人员（示例）", "演示员工的部门与职务", []datahub.Column{{Name: "用户名", Type: "text"}, {Name: "姓名", Type: "text"}, {Name: "部门", Type: "text"}, {Name: "职务", Type: "text"}}, staff, 2)

	for i, d := range demoDataSets {
		it := demoItem{Kind: "data_set", Slug: d.Slug, Title: d.Title, Result: "exists"}
		if _, err := s.store.GetDataSet(ctx, d.Slug); err == nil {
			items = append(items, it)
			continue
		}
		set, msg := cleanDataSet(&dataSetReq{Slug: d.Slug, Title: d.Title, Description: d.Description, SQL: d.SQL})
		err := errors.New(msg)
		if msg == "" {
			if err = s.store.CreateDataSet(ctx, set, by); err == nil {
				err = s.store.RecordDemo(ctx, "data_set", int64(i+1), d.Slug)
			}
		}
		if err != nil {
			it.Result, it.Error = "failed", err.Error()
		} else {
			it.Result = "created"
		}
		items = append(items, it)
	}
	return items
}

// demoClearData 删掉示例的表和数据集；返回删了几项。
func (s *Server) demoClearData(ctx context.Context, recs []store.DemoRecord) (int, error) {
	n := 0
	for _, rec := range recs {
		switch rec.Kind {
		case "data_set":
			if err := s.store.DeleteDataSet(ctx, rec.Slug); err != nil {
				return n, err
			}
			n++
		case "data_table":
			if s.opts.DataHub != nil {
				if err := s.opts.DataHub.DropTable(ctx, rec.Slug); err != nil {
					return n, fmt.Errorf("删示例表 %s：%w", rec.Slug, err)
				}
			}
			if err := s.store.DeleteDataTable(ctx, rec.Slug); err != nil {
				return n, err
			}
			n++
		}
	}
	return n, nil
}

// demoWeeklyWorkbench 是周航「我的客户周报」在数据中台可用时加上的工作台：我负责的客户。
func demoWeeklyWorkbench() *appWorkbench {
	return &appWorkbench{Panes: []wbPane{{ID: "main", Type: "panel", Title: "我的客户", Widgets: []wbWidget{
		{Type: "table", Title: "我负责的客户（数据中台）", Source: &wbSource{Dataset: "my-customers"}, Rows: "items",
			Columns:    []wbColumn{{Field: "name", Title: "客户"}, {Field: "arr", Title: "年合同额", Format: "money"}, {Field: "renew_at", Title: "续约日期", Format: "date"}, {Field: "risk", Title: "风险"}},
			RowActions: []wbAction{{Label: "写进周报", Prompt: "把客户「{{row.name}}」（{{row.renew_at}} 续约，风险{{row.risk}}）的情况写进这周的周报"}}},
		{Type: "actions", Title: "快捷", Actions: []wbAction{{Label: "写这周的周报", Prompt: "写这周的客户周报"}}},
	}}}}
}
