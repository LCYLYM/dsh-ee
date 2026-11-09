package api

import "testing"

func TestScopeConflictParam(t *testing.T) {
	cases := []struct {
		name   string
		scopes []string
		want   string
	}{
		{name: "nil", scopes: nil, want: ""},
		{name: "empty", scopes: []string{}, want: ""},
		{name: "one", scopes: []string{"@company"}, want: "@company"},
		{name: "many", scopes: []string{"@company", "@acme"}, want: "@company、@acme"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := scopeConflictParam(tc.scopes); got != tc.want {
				t.Fatalf("scopeConflictParam(%v) = %q, want %q", tc.scopes, got, tc.want)
			}
		})
	}
}
