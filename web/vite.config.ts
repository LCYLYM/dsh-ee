import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 监听所有网卡，允许局域网 / 外部 IP 访问原型
  server: { host: "0.0.0.0", port: 5188, strictPort: true, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 5188, strictPort: true, allowedHosts: true },
});
