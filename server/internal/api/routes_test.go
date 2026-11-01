package api

import (
	"io"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
)

func newBareServer(t *testing.T) *Server {
	t.Helper()
	return New(nil, nil, Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// 每条路由要么有 Agent 工具，要么写明了为什么没有；表里不能有不存在的路由。
func TestRouteAgentCoverage(t *testing.T) {
	s := newBareServer(t)
	patterns := map[string]*route{}
	for i := range s.routeTable {
		rt := &s.routeTable[i]
		if patterns[rt.pattern] != nil {
			t.Fatalf("路由重复：%s", rt.pattern)
		}
		patterns[rt.pattern] = rt
		n := 0
		if rt.agent != nil {
			n++
		}
		if agentExcluded[rt.pattern] != "" {
			n++
		}
		if agentPending[rt.pattern] != "" {
			n++
		}
		switch {
		case n == 0:
			t.Errorf("路由 %s 既没有 Agent 工具，也没写在 agentExcluded / agentPending 里", rt.pattern)
		case n > 1:
			t.Errorf("路由 %s 同时出现在多处（工具 / agentExcluded / agentPending 只能选一个）", rt.pattern)
		}
	}
	for name, m := range map[string]map[string]string{"agentExcluded": agentExcluded, "agentPending": agentPending} {
		for p, why := range m {
			if patterns[p] == nil {
				t.Errorf("%s 里的 %s 不是一条存在的路由", name, p)
			}
			if strings.TrimSpace(why) == "" {
				t.Errorf("%s 里的 %s 没写原因", name, p)
			}
		}
	}
	for p := range agentSpecs {
		if patterns[p] == nil {
			t.Errorf("agentSpecs 里的 %s 不是一条存在的路由", p)
		}
	}
}

// 管理类路由即使以后给了工具，也不能出现在员工工具集里：agent 范围的权限点之外的路由，工具必须声明 admin 才能用。
func TestAgentSpecsAreWellFormed(t *testing.T) {
	s := newBareServer(t)
	pathVar := regexp.MustCompile(`\{([a-z_]+)(\.\.\.)?\}`)
	type key struct{ tool, name string }
	seen := map[string]string{}
	paramType := map[key]string{}
	for _, rt := range s.routeTable {
		sp := rt.agent
		if sp == nil {
			continue
		}
		id := sp.key()
		if seen[id] != "" {
			t.Errorf("%s 被 %s 和 %s 同时占用", id, seen[id], rt.pattern)
		}
		seen[id] = rt.pattern
		if sp.Summary == "" {
			t.Errorf("%s 缺少 Summary", id)
		}
		if sp.Effect != effRead && sp.En == "" {
			t.Errorf("%s 是写操作，缺少审批框用的英文 En", id)
		}
		if sp.Effect == effDanger && sp.Preview == nil {
			t.Errorf("%s 是危险操作，必须有 Preview", id)
		}
		if sp.Effect != effDanger && sp.Preview != nil {
			t.Errorf("%s 不是危险操作，不该有 Preview", id)
		}
		if rt.auth == authNone {
			t.Errorf("%s 对应的路由没有认证", id)
		}
		// 员工工具只能落在员工能用的权限点上，管理类权限点要等阶段 C 的管理模式
		employee := []string{rbac.PortalView, rbac.LLMUse, rbac.KeysSelf, rbac.RegistryUse, rbac.RegistryPublish}
		// 管理侧工具（Admin）由管理模式把关，路由权限点自然是管理类的
		if len(rt.perms) > 0 && !sp.Admin {
			ok := false
			for _, p := range rt.perms {
				ok = ok || slices.Contains(employee, p)
			}
			if !ok {
				t.Errorf("%s 的路由权限点 %v 里没有员工权限点，员工侧用不了", id, rt.perms)
			}
		}
		pathParams := map[string]bool{}
		for _, m := range pathVar.FindAllStringSubmatch(rt.pattern, -1) {
			pathParams[m[1]] = true
		}
		for _, pr := range sp.Params {
			if pr.Name == "action" || pr.Name == "confirm" {
				t.Errorf("%s 的参数名 %s 是保留字", id, pr.Name)
			}
			typ := pr.Type
			if pr.Schema != nil {
				typ, _ = pr.Schema["type"].(string)
			}
			if typ == "" {
				t.Errorf("%s 的参数 %s 没有类型", id, pr.Name)
			}
			k := key{sp.Tool, pr.Name}
			if prev, ok := paramType[k]; ok && prev != typ {
				t.Errorf("工具 %s 里参数 %s 在不同 action 里类型不一致：%s / %s", sp.Tool, pr.Name, prev, typ)
			}
			paramType[k] = typ
			if pr.In == "path" {
				field := pr.As
				if field == "" {
					field = pr.Name
				}
				if !pathParams[field] {
					t.Errorf("%s 的参数 %s 标了 path，但路由 %s 里没有 {%s}", id, pr.Name, rt.pattern, field)
				}
				delete(pathParams, field)
			}
		}
		if !sp.Local {
			for p := range pathParams {
				t.Errorf("%s 的路由有路径变量 {%s}，但没有对应的 path 参数", id, p)
			}
		}
	}
}

func TestArgsHash(t *testing.T) {
	a := argsHash("ee_tokens", map[string]any{"action": "revoke", "id": "at:1", "confirm": "x"})
	b := argsHash("ee_tokens", map[string]any{"id": "at:1", "action": "revoke"})
	if a != b {
		t.Fatal("confirm 不该参与哈希，键顺序不该影响哈希")
	}
	if a == argsHash("ee_tokens", map[string]any{"action": "revoke", "id": "at:2"}) {
		t.Fatal("参数变了哈希必须变")
	}
	if a == argsHash("ee_hub", map[string]any{"action": "revoke", "id": "at:1"}) {
		t.Fatal("工具名要参与哈希")
	}
}

func TestCheckArgs(t *testing.T) {
	sp := &agentSpec{Tool: "ee_hub", Action: "create", Effect: effWrite, Params: []agentParam{
		{Name: "kind", Type: "string", Required: true, Enum: []string{"skill", "prompt"}},
		{Name: "id", Type: "integer"},
		{Name: "spec", Schema: map[string]any{"type": "object"}, Required: true},
	}}
	cases := []struct {
		name string
		args map[string]any
		want string
	}{
		{"合法", map[string]any{"action": "create", "kind": "skill", "spec": map[string]any{}}, ""},
		{"缺必填", map[string]any{"action": "create", "kind": "skill"}, "缺少必填参数 spec"},
		{"枚举外", map[string]any{"action": "create", "kind": "connection", "spec": map[string]any{}}, "kind 必须是"},
		{"未声明的参数", map[string]any{"action": "create", "kind": "skill", "spec": map[string]any{}, "secret": "x"}, "没有参数"},
		{"类型不对", map[string]any{"action": "create", "kind": "skill", "spec": "文本"}, "spec 必须是对象"},
		{"小数不是整数", map[string]any{"action": "create", "kind": "skill", "spec": map[string]any{}, "id": 1.5}, "id 必须是整数"},
		{"confirm 只给危险操作", map[string]any{"action": "create", "kind": "skill", "spec": map[string]any{}, "confirm": "x"}, "没有参数"},
		{"必填不能是空白", map[string]any{"action": "create", "kind": "  ", "spec": map[string]any{}}, "kind"},
	}
	for _, c := range cases {
		got := checkArgs(sp, c.args)
		if c.want == "" && got != "" || c.want != "" && !strings.Contains(got, c.want) {
			t.Errorf("%s：得到 %q，想要包含 %q", c.name, got, c.want)
		}
	}
}
