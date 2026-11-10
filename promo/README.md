# 介绍视频

README 第一屏的 36 秒介绍视频，用 [Remotion](https://www.remotion.dev/) 写成（React 画面，直接渲染成 MP4）。不进 dsh-ee 的构建。

- 分镜和文字：`src/Intro.tsx`、`src/copy.ts`（中英文两版，数字和 [示例公司设定](../docs/demo-company.md) 一致）
- 界面截图：`public/shots/<zh|en>/`，从导入了示例公司的 dsh-ee 上截的真图；第 2 幕的 DSH 对话是动画，画面上标了「示意画面」
- 成品：`out/`（不进 git）。README 用的 GIF 复制到 `docs/images/intro*.gif`

## 渲染

```sh
cd promo
pnpm install
pnpm studio                       # 浏览器里预览、调时间轴
pnpm render:zh && pnpm render:en  # 输出 out/intro-zh.mp4、out/intro-en.mp4
```

Remotion 默认会下载 Chrome Headless Shell；本机已有的话加 `--browser-executable=<路径>`。

## 转 GIF

Remotion 自带的 ffmpeg 是精简版，没有调色板滤镜，要用完整的 ffmpeg：

```sh
ffmpeg -i out/intro-zh.mp4 -vf "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" ../docs/images/intro.zh-CN.gif
ffmpeg -i out/intro-en.mp4 -vf "（同上）" ../docs/images/intro.gif
```

## 重新截图

界面改版后重截：

1. 起一个演示模式的 dsh-ee（`DSH_EE_DEMO_MODE=1`），用管理员导入示例公司。
2. 用演示员工周航走一遍设备登录，用拿到的令牌经 `/mcp` 调几次 `demo-crm__*` 工具，让「最近调用」有内容。
3. `BASE=http://127.0.0.1:8097 ADMIN_PASSWORD=… CHROME=<chromium 路径> node scripts/shots.mjs`（用 `e2e/` 里装好的 playwright-core）。
