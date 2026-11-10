package openapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const crmYAML = `
openapi: 3.0.3
info: {title: CRM}
servers: [{url: https://crm.example/api}]
paths:
  /customers/{id}:
    parameters:
      - {name: id, in: path, required: true, schema: {type: string}}
    get:
      operationId: getCustomer
      summary: Get one customer
      parameters:
        - {name: fields, in: query, schema: {type: string}, description: Comma separated}
        - {name: X-Trace, in: header, schema: {type: string}}
  /customers:
    post:
      summary: Create a customer
      requestBody:
        required: true
        content:
          application/json:
            schema: {$ref: '#/components/schemas/Customer'}
components:
  schemas:
    Customer:
      type: object
      required: [name]
      properties:
        name: {type: string, example: ACME}
        parent: {$ref: '#/components/schemas/Customer'}
`

func TestParse(t *testing.T) {
	spec, err := Parse([]byte(crmYAML))
	if err != nil {
		t.Fatal(err)
	}
	if spec.Title != "CRM" || spec.BaseURL != "https://crm.example/api" || len(spec.Tools) != 2 {
		t.Fatalf("解析结果不对：%+v", spec)
	}
	byName := map[string]Tool{}
	for _, tl := range spec.Tools {
		byName[tl.Name] = tl
	}
	get, ok := byName["getCustomer"]
	if !ok || !get.ReadOnly || get.Op.Method != "GET" || len(get.Op.Params) != 2 {
		t.Fatalf("GET 工具不对：%+v", get)
	}
	var schema map[string]any
	_ = json.Unmarshal(get.InputSchema, &schema)
	if req, _ := schema["required"].([]any); len(req) != 1 || req[0] != "id" {
		t.Fatalf("路径参数应必填：%s", get.InputSchema)
	}
	if strings.Contains(string(get.InputSchema), "X-Trace") {
		t.Fatal("请求头参数不应进工具参数")
	}
	post, ok := byName["post_customers"]
	if !ok || post.ReadOnly || !post.Op.Body {
		t.Fatalf("POST 工具不对：%+v", byName)
	}
	if strings.Contains(string(post.InputSchema), "$ref") || strings.Contains(string(post.InputSchema), "example") {
		t.Fatalf("$ref 应展开、example 应去掉：%s", post.InputSchema)
	}

	for doc, want := range map[string]string{
		"openapi: 2.0\npaths: {}":   "OpenAPI 3",
		"openapi: 3.1.0\npaths: {}": "没有任何操作",
		"{not yaml":                 "JSON / YAML",
	} {
		if _, err := Parse([]byte(doc)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("Parse(%q) = %v，期望包含 %q", doc, err, want)
		}
	}
}

func TestCall(t *testing.T) {
	var got *http.Request
	var body string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()
	op := Operation{Method: "POST", Path: "/customers/{id}/notes", Params: []Param{{Name: "id", In: "path", Required: true}, {Name: "notify", In: "query"}}, Body: true}
	h := http.Header{}
	h.Set("X-API-Key", "secret")
	args := map[string]any{"id": "a b/c", "notify": true, "body": map[string]any{"text": "hi"}}
	status, out, err := Call(context.Background(), ts.Client(), ts.URL+"/api/", op, args, h, 1<<20)
	if err != nil || status != 201 || string(out) != `{"ok":true}` {
		t.Fatalf("调用失败：%d %s %v", status, out, err)
	}
	if got.URL.EscapedPath() != "/api/customers/a%20b%2Fc/notes" || got.URL.Query().Get("notify") != "true" {
		t.Fatalf("请求地址不对：%s", got.URL)
	}
	if got.Header.Get("X-API-Key") != "secret" || body != `{"text":"hi"}` {
		t.Fatalf("请求头或请求体不对：%v %s", got.Header, body)
	}
	if _, _, err := Call(context.Background(), ts.Client(), ts.URL, op, map[string]any{}, nil, 10); err == nil {
		t.Fatal("缺少必填的路径参数应报错")
	}
	// 路径参数为空或带「..」会把请求改到别的接口上，不能发出去
	got = nil
	for _, bad := range []string{"", ".", "..", "../admin", `..\admin`, "a/../../admin"} {
		if _, _, err := Call(context.Background(), ts.Client(), ts.URL, op, map[string]any{"id": bad}, nil, 10); err == nil {
			t.Fatalf("路径参数 %q 应报错，实际请求了 %s", bad, got.URL.EscapedPath())
		}
	}
	if got != nil {
		t.Fatalf("不合法的路径参数不应发出请求：%s", got.URL)
	}
}
