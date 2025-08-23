# VibeWriting (Electron)

一个最小可运行的 Electron 应用骨架，用于快速开始。

## 项目介绍


## 运行要求
- 已安装 Node.js (建议 18+)
- 具有 npm 或 pnpm/yarn

## 本地开发
```bash
# 进入项目
cd vibewriting

# 安装依赖（网络环境下执行）
npm install

# 启动开发（Vite + Electron，热加载/热替换）
npm run dev

# 仅启动 Electron（加载已构建产物）
npm start
```

Dev 模式会自动启动 Vite 开发服务器并在 Electron 中加载 `http://localhost:5174`。

### 热加载说明
- 渲染进程热替换（HMR）：编辑 `renderer/src/App.jsx` 的任意文案，窗口将即时更新而无需手动刷新。
- 主进程自动重启：编辑 `main.js` 或 `preload.js`，Electron 将自动重启应用应用更改（由 nodemon 驱动）。

## 打包发布
使用 electron-builder 进行跨平台打包：

```bash
# 交互式选择平台（根据当前平台）
npm run build

# 或指定平台
npm run build:mac   # 打包 macOS (dmg/zip)
npm run build:win   # 打包 Windows (nsis/zip)
npm run build:linux # 打包 Linux (AppImage/deb)

# 仅打包目录（不生成安装包，可快速检查）
npm run pack
```

图标资源放置在 `build/` 目录：
- macOS: `build/icon.icns`
- Windows: `build/icon.ico`
- Linux: `build/icon.png`（至少 512x512）

## 结构说明
- `src/main/`：主进程入口与模块（如 `pdf.js`）
- `src/preload/`：预加载脚本，使用 contextBridge 暴露安全 API
- `src/renderer/`：React + Vite 渲染进程源码
- `dist/`：渲染进程构建输出（由 `vite build` 产生）
- `build/`：存放打包图标与构建资源

## 安全与设置
- 已启用 `contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`
- 生产构建中建议开启 `sandbox: true` 并添加合适的 CSP

## 常见问题
- 如果 `npm start` 报找不到 `electron`，请确认依赖安装成功，或切换国内镜像源后重试
- macOS 下首次启动如无菜单栏，可通过快捷键 `Cmd+Q` 退出；已默认隐藏菜单栏

祝使用愉快！
