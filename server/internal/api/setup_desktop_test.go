package api_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func writeFakeExecutable(t *testing.T, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte("#!/bin/sh\n"+body), 0o700); err != nil {
		t.Fatal(err)
	}
}

func TestSetupDesktopShell(t *testing.T) {
	ts, admin := setupScriptServer(t)
	code, body := admin.do("POST", "/api/admin/connect/publish", map[string]bool{"force": true}, nil)
	expect(t, "发布接入插件", code, 200, body)
	script := getScript(t, ts.URL, "/setup.sh")
	root := t.TempDir()
	app := filepath.Join(root, "DeepSeek Harness.app")
	writeFakeExecutable(t, filepath.Join(app, "Contents/Resources/runtime/cli/bin/dsh"), `printf 'dsh %s\n' "$*" >> "$FAKE_LOG"`+"\n")
	writeFakeExecutable(t, filepath.Join(app, "Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"), `printf 'node %s\n' "$*" >> "$FAKE_LOG"`+"\n")
	bin := filepath.Join(root, "bin")
	writeFakeExecutable(t, filepath.Join(bin, "uname"), "printf 'Darwin\\n'\n")
	writeFakeExecutable(t, filepath.Join(bin, "curl"), "printf '{}\\n'\n")
	writeFakeExecutable(t, filepath.Join(bin, "sleep"), "printf 'sleep %s\\n' \"$*\" >> \"$FAKE_LOG\"\n")
	writeFakeExecutable(t, filepath.Join(bin, "pgrep"), `n=0
if [ -f "$FAKE_PGREP_DONE" ]; then n=$(cat "$FAKE_PGREP_DONE"); fi
n=$((n + 1))
printf '%s\n' "$n" > "$FAKE_PGREP_DONE"
if [ "$n" -le 2 ]; then exit 0; fi
exit 1`+"\n")
	home := filepath.Join(root, "home")
	dshHome := filepath.Join(root, "dsh-home")
	if err := os.MkdirAll(filepath.Join(dshHome, "profiles", "desktop"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	npmrc := filepath.Join(home, ".npmrc")
	original := "foo=bar\n@other:registry=https://other.example/npm/\nregistry=https://old.example/npm/\n@company:registry=https://old.example/npm/\n"
	if err := os.WriteFile(npmrc, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(root, "setup.sh")
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(root, "calls.log")
	pgrepDone := filepath.Join(root, "pgrep.done")
	cmd := exec.Command("sh", scriptPath, "--token", "ee_at_test")
	cmd.Env = []string{"HOME=" + home, "DSH_HOME=" + dshHome, "DSH_DESKTOP_APP=" + app, "PATH=" + bin + ":/usr/bin:/bin", "FAKE_LOG=" + log, "FAKE_PGREP_DONE=" + pgrepDone}
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Desktop 脚本执行失败：%v\n%s", err, output)
	}
	if !strings.Contains(string(output), "请按 ⌘Q") {
		t.Fatalf("Desktop 运行中应提示完全退出：%s", output)
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(calls), "dsh plugin --profile desktop add @company/dsh-connect@latest") || !strings.Contains(string(calls), "sleep 2") {
		t.Fatalf("内置 dsh 参数或等待行为不对：%s", calls)
	}
	npmrcData, err := os.ReadFile(npmrc)
	if err != nil {
		t.Fatal(err)
	}
	text := string(npmrcData)
	for _, want := range []string{"foo=bar", "@other:registry=https://other.example/npm/", "registry=" + ts.URL + "/npm/", "@company:registry=" + ts.URL + "/npm/"} {
		if !strings.Contains(text, want) {
			t.Errorf(".npmrc 缺少 %q：%s", want, text)
		}
	}
	if strings.Contains(text, "https://old.example/npm/") {
		t.Fatalf("旧 registry 应被替换：%s", text)
	}
	info, err := os.Stat(npmrc)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf(".npmrc 权限应为 600：%v %v", info.Mode(), err)
	}

	noProfileHome := filepath.Join(root, "no-profile-home")
	noProfileDSH := filepath.Join(root, "no-profile-dsh")
	if err := os.MkdirAll(noProfileHome, 0o700); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command("sh", scriptPath, "--token", "ee_at_test")
	cmd.Env = []string{"HOME=" + noProfileHome, "DSH_HOME=" + noProfileDSH, "DSH_DESKTOP_APP=" + app, "PATH=" + bin + ":/usr/bin:/bin", "FAKE_LOG=" + log, "FAKE_PGREP_DONE=" + pgrepDone}
	output, err = cmd.CombinedOutput()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
		t.Fatalf("缺 profile 应退出 1：%v\n%s", err, output)
	}
	if !strings.Contains(string(output), "请先打开一次 DSH 再完全退出，然后重新运行本命令") {
		t.Fatalf("缺 profile 提示不对：%s", output)
	}
}
