## 改动

<!-- 一句话说明改了什么、为什么 -->

## 验证

- [ ] `npm test`
- [ ] `npm run typecheck`（改动 `index.ts` 或有类型影响时）
- [ ] `npm run test:host`（改动 TUI、命令加载或恢复流程时）

## 影响面

- [ ] 涉及子 Agent 识别规则 → 已同步 README「如何识别子 Agent」与 DESIGN.md
- [ ] 涉及会话文件读取或缓存 → 已确认仍然只读、不写入磁盘
- [ ] 仅文档 / 测试
