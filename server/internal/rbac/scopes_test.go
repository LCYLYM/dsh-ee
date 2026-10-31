package rbac

import "testing"

func TestScopeFilter(t *testing.T) {
	member := &Access{RoleCodes: []string{RoleMember}, Perms: map[string]bool{
		PortalView: true, LLMUse: true, RegistryUse: true, RegistryPublish: true, UsersManage: true,
	}}
	got := ScopeFilter(member, []string{ScopeModels, ScopeRegistryRead, ScopeHub, ScopeConnections})
	if !got.Has(LLMUse, RegistryUse, PortalView) {
		t.Fatalf("员工 scope 应保留对应权限：%+v", got)
	}
	if got.Has(RegistryPublish, UsersManage) {
		t.Fatalf("未声明的 scope 不应放大权限：%+v", got)
	}
	got = ScopeFilter(member, []string{ScopeAdmin})
	if !got.Has(UsersManage) || got.Has(LLMUse) {
		t.Fatalf("管理 scope 只应保留管理权限：%+v", got)
	}

	super := &Access{Super: true}
	got = ScopeFilter(super, []string{ScopeModels})
	if got.Super || !got.Has(LLMUse) || got.Has(UsersManage) {
		t.Fatalf("超管令牌也受 scope 限制：%+v", got)
	}
	got = ScopeFilter(super, []string{ScopeAdmin})
	if !got.Super || !got.Has(UsersManage, LLMUse) {
		t.Fatalf("超管管理 scope 应保留全部权限：%+v", got)
	}
}
