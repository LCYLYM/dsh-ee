import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 后端（server/）地址；同源代理让会话 cookie 直接可用
const backend = "http://127.0.0.1:8080";
const proxy = { "/api": backend, "/v1": backend };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 监听所有网卡，允许局域网 / 外部 IP 访问原型
  server: { host: "0.0.0.0", port: 5188, strictPort: true, allowedHosts: true, proxy },
  preview: { host: "0.0.0.0", port: 5188, strictPort: true, allowedHosts: true, proxy },
});
