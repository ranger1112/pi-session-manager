# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Pi 扩展（`pi-main-session-manager`）：注册 `/sessions` 和 `/resume-main`，按最近活动列出历史会话并通过 Pi 的会话切换 API 恢复。核心特性是**默认隐藏已核验的子 Agent 会话**，识别依据是 `@tintinweb/pi-subagents` 的持久化格式，而不是 Pi 官方协议。

界面与文档均为简体中文，新增用户可见文案保持中文。

## 常用命令

```sh
npm test                                  # 全部单元测试（node:test，无需 npm install）
node --test tests/store.test.mjs          # 单个测试文件
node --test --test-name-pattern="缓存" tests/*.test.mjs   # 按测试名过滤
npm install                               # typecheck 与宿主检查的前置
npm run typecheck                         # tsc --noEmit（index.ts + src/*.mjs 推断）
npm run test:host                         # 宿主检查，使用已安装的 Pi 包
node tests/host-smoke.mjs <pi-install-dir> # 或指定本机 Pi 安装目录
```

没有构建、lint 或类型检查步骤：`index.ts` 由 Pi 宿主直接加载，`src/*.mjs` 是纯 ESM。测试只依赖 Node 内置模块和临时目录中的合成 JSONL，不读取真实历史。

## 架构

数据流：`index.ts` → `scope.sessionStorage()` → `store.list()` → `sessions.readEvidence()` / `classifySessions()` → `picker.createPicker()` → `ctx.switchSession()`。

- **`index.ts`** — Pi 扩展入口。检查 `ctx.mode === 'tui'` 与 `ctx.isIdle()`，解析 `all` / `agents` 参数，把 `Input`/`SelectList` 等 TUI 原语和 load 回调注入 picker，最后调用 `ctx.switchSession(target, ...)`。模块级单例 `store` 承载缓存。
- **`src/picker.mjs`** — 自绘 TUI 组件（`createPicker`）。持有搜索框、当前范围、`loading/error/unreadable` 状态和 `generation` 计数；每次范围切换或刷新都 abort 旧请求并以代数丢弃过期回调。分页由自己按可见行数实现，不依赖宿主 `SelectList` 的分页。UI 原语通过参数注入，测试才能用假的 `Input`/`SelectList`。
- **`src/store.mjs`** — 目录发现（`discover`）、有限并发（`MAX_PARALLEL_READS = 6`）增量读取、基于 `size + mtimeMs` 的进程内缓存。同一遍扫描同时产出列表项与分类证据；父会话即使位于扫描目录之外也会被读取，但**只用于分类，不进列表**。`onDiagnostics` 单独回传不可读文件数，列表接口始终是数组。
- **`src/sessions.mjs`** — JSONL 流式提取（`readEvidence`）、三条证据的交叉核验（`classifySessions`）、搜索/排序/标题清洗（`selectSessions`、`sessionTitle`、`cleanText`）。`readEvidence` 逐行 `JSON.parse`，只统计顶层 `type`，大工具结果会被解析但正文不进入缓存。
- **`src/scope.mjs`** — 用与 Pi 相同的编码（`--<去掉开头斜杠、把 /\\: 换成 ->--`）判断 `sessionDir` 是否就是当前项目的默认目录。若是默认目录，`all` 才递归扫描 `agentDir/sessions`；自定义 `sessionDir` 的 `all` 被限制在该存储内。

## 关键不变量

- **隐藏子 Agent 必须三证齐全**：会话有 `parentSession`、最早的 `session_info.name` 匹配 `类型#8位十六进制`、父会话中 `Agent` 工具结果的 `details.subagentType#details.agentId前8位` 等于该名称。缺任何一项 → `classification: 'unknown'`，**保留显示**而不是隐藏。`parentSession` 单独不足以判定（手动 fork/clone 也带它）。修改分类逻辑时同步更新 README「如何识别子 Agent」与 DESIGN.md。
- 扩展**只读**会话文件：不删除、不重命名、不关闭子 Agent 持久化、不发起网络请求、不执行会话内容。
- 取消是常态路径：`AbortSignal` 贯穿 store/sessions，取消必须抛出 `AbortError` 而不是被计入 `unreadable`。
- 新增或修改路径比较时必须处理 Windows 大小写（`resolve` + `toLowerCase()`，与 `index.ts` 的 `samePath` 一致）。注意 `src/picker.mjs` 目前仍用裸 `===` 比较 `currentPath`/`selectedPath`，尚未统一。
- 缓存只存在进程内，`/reload` 或重启即清空；不要引入磁盘缓存。

## 测试约定

- 用 `node:test` + `node:assert/strict`，中文测试名描述行为。
- 文件与分类测试用 `mkdtemp(tmpdir())` 写合成 JSONL，`finally` 中 `rm`。
- picker 测试注入假的 `Input`、`SelectList`、`matchesKey`、`truncateToWidth` 和 `theme`，不依赖真实 Pi 包。
- `tests/host-smoke.mjs` 依赖 Pi 当前安装布局中的内部模块路径（`dist/core/extensions/loader.js`、`pi-tui/dist/index.js`），宿主升级后可能需要调整。它默认通过 `import.meta.resolve` 使用 devDependencies 里的 Pi 包，传参则改用本机安装目录。
- CI（`.github/workflows/ci.yml`）分三个 job：`npm test`（Ubuntu/Windows × Node 22.19.0/24.x，不安装依赖）、`typecheck`、`host-smoke`。
