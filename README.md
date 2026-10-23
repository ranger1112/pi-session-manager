# Pi Main Session Manager

在 Pi 中输入 `/sessions`，默认隐藏已核验的子 Agent 会话，按最近活动平铺显示历史。无需删除历史，也不必关闭子 Agent 的持久化。

使用 Pi 原生输入框和选择列表，支持搜索、当前项目／所有项目切换，以及直接恢复原始会话。

## 安装

需要 Node.js **22.19+** 和使用 `@earendil-works` 包的 Pi；当前界面为简体中文。

```sh
pi install git:github.com/ranger1112/pi-session-manager
```

然后在 Pi 中执行 `/reload`，或重启 Pi。

本插件注册 `/sessions` 和 `/resume-main`，不会替换原生 `/resume` 或 `pi -r`。不要同时启用其他注册 `/sessions` 的扩展。

## 使用

```text
/sessions              当前项目，默认隐藏已核验的子 Agent
/sessions all          所有项目，默认隐藏已核验的子 Agent
/sessions agents       当前项目，包含子 Agent
/sessions all agents   所有项目，包含子 Agent
/resume-main           /sessions 的别名
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
- 内存缓存保留标题、首条消息前 600 个字符、统计和 Agent ID；不会写入磁盘或上传。
- 再次打开会核对文件大小与修改时间，只重读变化文件。`/reload` 或重启清空缓存。
- 首次打开需扫描历史，较大的目录可能需要等待；`Esc` 可取消。
- 自定义会话存储的“所有项目”限制在当前存储，不扩展到默认存储。

信任边界和已知限制见 [DESIGN.md](DESIGN.md)。请勿将真实会话、凭据、日志或生成的个人预览提交到本仓库。

## 开发与测试

```sh
git clone https://github.com/ranger1112/pi-session-manager.git
cd pi-session-manager
npm test
```

单元测试只使用内存数据和临时目录里的合成会话，不读取个人历史，不需要安装依赖。

通过本地路径加载开发版：

```sh
pi install /absolute/path/to/pi-session-manager
```

修改后运行 `/reload`。开发版与 Git 版不要同时启用。

可选的宿主集成检查使用本机 Pi 安装目录，检查扩展加载、命令恢复／取消和真实 TUI 组件；仅使用合成记录，不扫描个人历史：

```sh
node tests/host-smoke.mjs /absolute/path/to/pi-coding-agent
```

该检查依赖 Pi 当前安装布局中的测试用加载接口，宿主升级后可能需要调整。Windows 下也可传入加引号的绝对路径。当前已在 Windows、Node.js 22.23.2、Pi / Pi TUI 1.3.0 上验证；会话切换使用模拟上下文，TUI 使用真实组件。

npm 包名为 `pi-main-session-manager`，以免与已有 `pi-session-manager` 混淆；当前通过 Git 安装，未发布 npm。

## 参考与致谢

交互设计参考了 MIT 开源项目 [@vanillagreen/pi-session-manager](https://github.com/vanillagreencom/kendex/tree/main/pi-extensions/pi-session-manager)（参考版本 `2.0.4`），包括独立会话选择器、项目范围切换，以及通过 Pi 会话切换 API 恢复历史的思路。

本项目为独立实现，不是 Kendex 或 Pi 官方组件，没有复制 Kendex 源码，也未包含其删除、模型固定、设置管理或树形浏览实现。

Pi API 和 TUI 使用方式依据 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。

## 许可证

[MIT](LICENSE) © ranger
