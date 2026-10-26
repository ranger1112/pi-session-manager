# Pi Main Session Manager

[![CI](https://github.com/ranger1112/pi-session-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/ranger1112/pi-session-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.0-brightgreen)](package.json)

在 Pi 中输入 `/session-manager`，默认隐藏已核验的子 Agent 会话，按最近活动平铺显示历史。无需删除历史，也不必关闭子 Agent 的持久化。

使用 Pi 原生输入框和选择列表，支持搜索、当前项目／所有项目切换，以及直接恢复原始会话。

## 安装

需要 Node.js **22.19+** 和使用 `@earendil-works` 包的 Pi；界面支持简体中文和英文，默认按系统语言选择。

```sh
pi install git:github.com/ranger1112/pi-session-manager
```

然后在 Pi 中执行 `/reload`，或重启 Pi。

固定发布版本（需要安装器支持 git ref）：

```sh
pi install git:github.com/ranger1112/pi-session-manager#v0.1.0
```

主命令为 `/session-manager`，保留 `/sessions` 和 `/resume-main` 作为兼容别名，三者接受相同参数。不会替换 Pi 内置的 `/session`（会话信息）、`/resume` 或 `pi -r`。不要同时启用其他注册这些插件命令的扩展。

## 兼容性

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 22.19.0 |
| Pi / Pi TUI | 1.4.0 与 1.3.0 已验证；以 peerDependency `*` 声明 |
| 操作系统 | Windows、Linux（CI 覆盖）；macOS 未单独验证 |
| 终端 | Pi 的交互式 TUI 模式，非交互模式会提示不可用 |

## 使用

```text
/session-manager              当前项目，默认隐藏已核验的子 Agent
/session-manager all          所有项目，默认隐藏已核验的子 Agent
/session-manager agents       当前项目，包含子 Agent
/session-manager all agents   所有项目，包含子 Agent
/session-manager lang zh-CN    界面固定为简体中文
/session-manager lang en       界面固定为英文
/session-manager lang auto     恢复自动语言选择
/sessions                     /session-manager 的兼容别名
/resume-main                  /session-manager 的兼容别名
```

| 操作 | 按键 |
| --- | --- |
| 搜索标题、首条消息与项目目录 | 直接输入，空格分隔的关键词必须全部匹配 |
| 选择会话 | `↑` / `↓`、`PageUp` / `PageDown` |
| 恢复选中的原始会话 | `Enter` |
| 切换当前项目／所有项目 | `Tab` |
| 切换隐藏子 Agent／显示全部 | `Ctrl+A` |
| 刷新列表 | `Ctrl+R` |
| 关闭选择器 | `Esc` |

表中选择、分页、确认与取消按键为 Pi 默认绑定；也支持自定义 `tui.select.*` 键位。`Tab`、`Ctrl+A` 和 `Ctrl+R` 为本插件固定快捷键。

### 更容易辨认会话

- 正常命名会话保持原名称；仅由附件路径组成的名称视为路径式名称。附件开头时优先展示第一条去除附件路径后的用户文字，例如“[图片 ×2] 飞书同步没有更新价格”。支持多个路径、带引号的含空格路径以及图片块；只有路径的首消息会继续寻找后续用户文字，不使用模型或助手回复猜测标题。
- 纯附件且始终没有文字时，使用文件名/数量兜底；剪贴板随机文件名改用附件类型、数量和最近活动时间。识别仅改变展示，原始名称、首消息路径仍可搜索。
- 列表显示“显示/匹配数、可见数、总数、隐藏数和未核验数”，筛选名为“隐藏已核验子 Agent”，不会把未核验记录误称为已确认的主会话。
- 当前项目列表不重复项目路径；所有项目列表显示项目名。日期显示到分钟，较窄终端优先保留标题。
- 高度足够时，选中项下方优先显示起始请求、最近提问（不同于起始请求时）、起始附件数量，再显示项目目录、时间、消息数和分类原因；起始原文路径及会话文件路径放在末尾。空间不足时缩减或隐藏详情。各文本字段最多保留 600 个字符，长行按终端宽度裁剪，不改写原数据。

### 界面语言

`auto` 按 `LC_ALL` → `LC_MESSAGES` → `LANG` → 系统 locale 的顺序检测；中文 locale 使用 `zh-CN`，其他或无法识别的 locale 使用英文。现有中文用户可用 `/session-manager lang zh-CN` 固定中文。

语言偏好保存在 Pi agent 目录的 `pi-main-session-manager.json`，不修改 Pi 的 `settings.json`，也不写入会话文件。设置后下次打开选择器即生效；命令描述在 `/reload` 或重启后更新。标题、消息、路径、Agent 类型与底层错误原文不翻译。

每次打开默认隐藏已核验的子 Agent。加载期间可以取消；不会使用上一范围的旧列表执行恢复。终端高度变化后列表会调整可见行数，并保留选中项。若扫描跳过不可读文件或目录，完成后会保留警告，提示列表可能不完整。

第一版专注查找与恢复，不提供删除、批量清理、重命名或模型覆盖。恢复走 Pi 的会话切换 API，不把摘要导入当前会话，不创建会话副本。

## 如何识别子 Agent

Pi 的 `parentSession` 只说明父子关联，手动 `/fork`、`/clone` 也会使用它。仅凭这个字段隐藏记录，会误伤正常分支。

本插件针对 **`@tintinweb/pi-subagents`** 的记录交叉核验：

1. 会话存在父会话关系。
2. 会话最早的 `session_info` 名称符合 `类型#8位十六进制ID`。
3. 父会话中的 `Agent` 工具结果，其 `details.subagentType` 和 `details.agentId` 前八位与该初始名称匹配。

三项匹配才隐藏。改过显示名称的子 Agent 仍可识别；从子 Agent 手动 fork 的记录不会仅因继承了名称而被隐藏。

**这不是适用于所有 Agent 插件的通用分类器。** 父记录缺失、没有对应工具结果的 scheduler／mention 创建记录、定制类型名称等，可能无法核验。这类候选会保留显示，并计入“未核验”数量，而不是冒险隐藏。可用 `Ctrl+A` 查看完整列表。

## 性能与隐私

- 会话文件只读，不修改历史，不关闭子 Agent 持久化。
- 单次流式扫描同时提取列表和分类证据，不建立完整正文索引。
- 内存缓存保留标题、首条消息/首条有效请求/最近提问各前 600 个字符、起始附件计数与最多 3 个短文件名、统计和 Agent ID；不会保存图片数据，不会写入磁盘或上传。
- 再次打开会核对文件大小与修改时间，只重读变化文件，并从缓存移除已删除的会话。`/reload` 或重启清空缓存。
- 首次打开需扫描历史，较大的目录可能需要等待；`Esc` 可取消。
- 自定义会话存储的“所有项目”限制在当前存储，不扩展到默认存储。

性能基线使用固定合成正文，分别报告冷读取、缓存命中、搜索预处理/查询与流式读取取消耗时；不等同于真实大型历史的性能。可用 `node scripts/benchmark.mjs --small` 快速验证。

信任边界和已知限制见 [DESIGN.md](DESIGN.md)。请勿将真实会话、凭据、日志或生成的个人预览提交到本仓库。

## 常见问题

**首次打开很慢？** 首次需要流式扫描会话目录，历史较大时需要等待；之后只重读文件大小或修改时间变化的文件，`Esc` 可随时取消。

**某些子 Agent 会话仍然显示？** 识别只针对 `@tintinweb/pi-subagents` 的特定持久化格式。父记录缺失、名称被定制或工具结果不完整时无法核验，会保留显示并计入“未核验”；可用 `Ctrl+A` 查看完整列表。

**`/session-manager` 没有生效？** 更新插件后运行 `/reload`，需要交互式 TUI 且会话空闲；不要同时启用其他注册 `/session-manager`、`/sessions` 或 `/resume-main` 的扩展。

**“所有项目”只显示了一部分？** 使用自定义会话存储时，“所有项目”被限制在该存储内，不会扩展到默认存储。

**会修改或删除我的历史吗？** 不会。插件只读会话文件，恢复由 Pi 的会话切换 API 执行。

## 开发与测试

```sh
git clone https://github.com/ranger1112/pi-session-manager.git
cd pi-session-manager
npm test          # 单元测试，无需安装依赖
npm install       # typecheck 与宿主检查需要
npm run typecheck
npm run test:host
npm run benchmark  # 临时目录合成 1,000 / 10,000 条会话，不读取个人历史
```

单元测试只使用内存数据和临时目录里的合成会话，不读取个人历史，也不需要安装依赖。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。

通过本地路径加载开发版：

```sh
pi install /absolute/path/to/pi-session-manager
```

修改后运行 `/reload`。开发版与 Git 版不要同时启用。

宿主集成检查会加载扩展、检查命令恢复／取消和真实 TUI 组件；仅使用合成记录，不扫描个人历史。默认使用 `npm install` 安装的 Pi 包，也可传入本机 Pi 安装目录（Windows 下需加引号）：

```sh
npm run test:host
node tests/host-smoke.mjs /absolute/path/to/pi-coding-agent
```

该检查依赖 Pi 当前安装布局中的测试用加载接口，宿主升级后可能需要调整。当前 CI 在 Ubuntu 与 Windows 上使用 Node 22.19.0 / 24.x 验证，Pi 包为 1.4.0（1.3.0 也验证过）；会话切换使用模拟上下文，TUI 使用真实组件。

CI 在 Ubuntu 与 Windows 上运行 Node 22.19.0 / 24.x 的单元测试，并执行 typecheck 与宿主检查。

npm 包名为 `pi-main-session-manager`，以免与已有 `pi-session-manager` 混淆；当前通过 Git 安装，未发布 npm。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 参考与致谢

交互设计参考了 MIT 开源项目 [@vanillagreen/pi-session-manager](https://github.com/vanillagreencom/kendex/tree/main/pi-extensions/pi-session-manager)（参考版本 `2.0.4`），包括独立会话选择器、项目范围切换，以及通过 Pi 会话切换 API 恢复历史的思路。

本项目为独立实现，不是 Kendex 或 Pi 官方组件，没有复制 Kendex 源码，也未包含其删除、模型固定、设置管理或树形浏览实现。

Pi API 和 TUI 使用方式依据 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。

## 许可证

[MIT](LICENSE) © ranger
