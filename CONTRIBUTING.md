# 贡献指南

## 环境

- Node.js ≥ 22.19.0
- 单元测试不需要安装依赖；`typecheck` 与宿主检查需要 `npm install`

## 常用命令

```sh
npm test            # 单元测试
npm run typecheck   # tsc --noEmit
npm run test:host   # 宿主集成检查（使用已安装的 Pi 包）
```

`npm run test:host` 也可以接收本机 Pi 安装目录：`node tests/host-smoke.mjs /path/to/pi-coding-agent`。

## 必须遵守的约束

- **子 Agent 识别不能放宽**：只有父会话 `Agent` 工具结果与子会话初始名称交叉匹配时才隐藏；无法核验时保留显示。修改规则需同步 README「如何识别子 Agent」与 DESIGN.md。
- **保持会话只读**：不删除、重命名或写入会话文件，不引入磁盘缓存；语言偏好仅通过 `lang` 命令写独立配置，不修改 Pi settings。
- **UI 文案集中在 `src/i18n.mjs`**，同时提供简体中文与英文；文档、测试名使用简体中文。
- 新增行为需要单元测试；涉及 TUI 或命令流程时补充 `tests/host-smoke.mjs`。

## 提交与 PR

- 提交前缀：`feat:`、`fix:`、`chore:`、`docs:`。
- PR 需要 CI 全绿（测试矩阵、typecheck、host-smoke）。
- 按 PR 模板填写验证结果与影响面。

## 发布流程

1. 更新 `package.json` 的 `version` 与 `CHANGELOG.md`。
2. 提交后打 tag：`git tag -a vX.Y.Z -m "vX.Y.Z"`。
3. 推送 tag：`git push origin vX.Y.Z`。

`Release` 工作流会重新运行测试、typecheck 与宿主检查，通过后自动创建 GitHub Release。tag 对应的提交若未通过检查，发布不会发生。

本项目未发布到 npm；用户通过 Git 安装。
