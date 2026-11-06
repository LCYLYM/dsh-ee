package store

import (
	"context"
	"slices"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
)

// 0013 之前的默认菜单（「工作台」一组装着员工页面）。
var menusBefore0013 = []rbac.Menu{
	{Kind: "group", Title: "工作台", Children: []rbac.Menu{
		{Kind: "page", Title: "我的工作台", Path: "/workbench", PageKey: "workbench", Permission: rbac.PortalView},
		{Kind: "page", Title: "微应用", Path: "/apps", PageKey: "apps", Permission: rbac.PortalView},
		{Kind: "page", Title: "能力中心", Path: "/hub", PageKey: "market", Permission: rbac.PortalView},
		{Kind: "page", Title: "知识库", Path: "/knowledge", PageKey: "knowledge", Permission: rbac.PortalView},
		{Kind: "page", Title: "下载 DSH", Path: "/dsh", PageKey: "dsh-download", Permission: rbac.PortalView},
		{Kind: "page", Title: "接入指南", Path: "/setup", PageKey: "setup", Permission: rbac.PortalView},
		{Kind: "page", Title: "分享能力", Path: "/publish", PageKey: "publish", Permission: rbac.PortalView},
		{Kind: "page", Title: "我的令牌", Path: "/tokens", PageKey: "my-keys", Permission: rbac.KeysSelf},
	}},
	{Kind: "group", Title: "管理", Children: []rbac.Menu{
		{Kind: "page", Title: "总览", Path: "/admin", PageKey: "admin-dashboard", Permission: rbac.DashboardView},
	}},
}

// 已有部署升级到 0013：还是默认值的菜单按「用 / 造 / 接入」重排，管理员改过的不动。
func TestMigrateMenusToBuild(t *testing.T) {
	ctx := context.Background()
	for _, renamed := range []bool{false, true} {
		st := openTokenTestStore(t)
		if err := st.ResetMenus(ctx, menusBefore0013); err != nil {
			t.Fatal(err)
		}
		if renamed {
			if _, err := st.DB().ExecContext(ctx, "UPDATE menus SET title = '应用广场' WHERE page_key = 'apps'"); err != nil {
				t.Fatal(err)
			}
		}
		// 退回到 0013 之前，再迁移一次
		for _, q := range []string{
			"ALTER TABLE assets DROP COLUMN pending_scope",
			"ALTER TABLE assets DROP COLUMN scope_requested_at",
			"ALTER TABLE assets DROP COLUMN scope_note",
			"DELETE FROM schema_migrations WHERE version = '0013_build'",
		} {
			if _, err := st.DB().ExecContext(ctx, q); err != nil {
				t.Fatal(err)
			}
		}
		if err := st.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		ms, err := st.ListMenus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		byID := map[int64]*Menu{}
		byKey := map[string]*Menu{}
		var groups []string
		for _, m := range ms {
			byID[m.ID] = m
			if m.Kind == "group" {
				groups = append(groups, m.Title)
			} else {
				byKey[m.PageKey] = m
			}
		}
		if !slices.Equal(groups, []string{"用", "造", "接入", "管理"}) {
			t.Fatalf("分组：%v", groups)
		}
		parent := func(key string) string {
			m := byKey[key]
			if m == nil || m.ParentID == nil {
				return ""
			}
			return byID[*m.ParentID].Title
		}
		if byKey["market"] != nil {
			t.Fatal("默认的「能力中心」应去掉")
		}
		for key, want := range map[string]string{"apps": "用", "knowledge": "用", "workbench": "用", "app-new": "造", "build": "造", "templates": "造", "materials": "造", "publish": "造", "dsh-download": "接入", "setup": "接入", "my-keys": "接入"} {
			if got := parent(key); got != want {
				t.Fatalf("%s 应在「%s」里，实际「%s」", key, want, got)
			}
		}
		if byKey["publish"].Visible || byKey["publish"].Title != "分享插件" {
			t.Fatalf("上传插件的页面应隐藏：%+v", byKey["publish"])
		}
		if renamed {
			if byKey["apps"].Title != "应用广场" {
				t.Fatalf("管理员改过的标题不应覆盖：%+v", byKey["apps"])
			}
		} else if byKey["apps"].Title != "企业应用" || byKey["knowledge"].Title != "知识问答" {
			t.Fatalf("默认标题应更新：%+v %+v", byKey["apps"], byKey["knowledge"])
		}
		if byKey["apps"].Sort >= byKey["workbench"].Sort {
			t.Fatal("企业应用应排在我的工作台前面（默认首页）")
		}
	}
}
