package api

import "testing"

func TestCheckHomeWidgets(t *testing.T) {
	wb := &appWorkbench{Panes: []wbPane{{ID: "p", Type: "panel", Widgets: []wbWidget{
		{Type: "metric", Title: "a", Home: true, Source: &wbSource{Connection: "x", Tool: "y"}},
		{Type: "markdown", Home: true},
	}}}}
	if msg := checkHomeWidgets(wb); msg == "" {
		t.Fatal("markdown 组件不该能上首页")
	}
	wb2 := &appWorkbench{Panes: []wbPane{{ID: "p", Type: "panel", Widgets: []wbWidget{
		{Type: "metric", Home: true, Source: &wbSource{Connection: "x"}},
		{Type: "table", Home: true, Source: &wbSource{Connection: "x"}},
		{Type: "chart", Home: true, Source: &wbSource{Connection: "x"}},
	}}}}
	if msg := checkHomeWidgets(wb2); msg == "" {
		t.Fatal("超过 2 个应被拒绝")
	}
	wb3 := &appWorkbench{Panes: []wbPane{{ID: "p", Type: "panel", Widgets: []wbWidget{
		{Type: "metric", Home: true, Source: &wbSource{Connection: "x"}},
		{Type: "checklist", Home: true, Source: &wbSource{Connection: "x"}},
	}}}}
	if msg := checkHomeWidgets(wb3); msg != "" {
		t.Fatalf("合法配置被拒：%s", msg)
	}
}
