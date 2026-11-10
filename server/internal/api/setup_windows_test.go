//go:build windows

package api

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestSetupEnvPowerShell 在 Windows 上真正执行 setup.ps1 写 .env 的那段：
// 只断言字符串不够，PowerShell 5 的 Set-Content -Encoding utf8 会加 BOM，
// Node 的 process.loadEnvFile 会把 BOM 当成变量名的一部分。
func TestSetupEnvPowerShell(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env")
	if err := os.WriteFile(envFile, []byte("KEEP=1\r\n"+connectTokenEnv+"=old\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	script := "$DshDir = " + psQuote(dir) + "\n" +
		"$Token = 'tok-123'\n" +
		"$DeviceLogin = $false\n" +
		"$Pending = " + psQuote(filepath.Join(dir, "token.pending")) + "\n" +
		setupEnvPowerShell()
	scriptFile := filepath.Join(dir, "setup-env-test.ps1")
	// PowerShell 5 默认按 ANSI 读无 BOM 文件；脚本里有中文，测试脚本本身要带 BOM。
	if err := os.WriteFile(scriptFile, append([]byte{0xEF, 0xBB, 0xBF}, []byte(script)...), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile).CombinedOutput()
	if err != nil {
		t.Fatalf("powershell: %v\n%s", err, out)
	}
	data, err := os.ReadFile(envFile)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatalf(".env 不应带 UTF-8 BOM：%x", data[:3])
	}
	got := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.Contains(got, "KEEP=1\n") {
		t.Fatalf("原有变量应保留：%q", got)
	}
	if strings.Count(got, connectTokenEnv+"=") != 1 || !strings.Contains(got, connectTokenEnv+"=tok-123\n") {
		t.Fatalf("令牌应被替换且只出现一次：%q", got)
	}
}
