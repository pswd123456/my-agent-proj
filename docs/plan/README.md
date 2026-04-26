# 阶段文档目录

`docs/plan/` 保留阶段规划、实现规格和历史决策。这里的文档不都是“当前运行事实”，阅读时要先区分它是历史草稿、已落地规格，还是 capability 专项方案。

如果 `docs/plan/` 和 `docs/architecture/` 或代码实现冲突，优先以当前实现和架构文档为准，再回写这里的阶段说明。

## 文档列表

- [Stage 1 基础运行时草稿（历史）](./stage1.md)
- [Stage 2 reasoning / trace 规格](./stage2.md)
- [Stage 3 skill system v1](./stage3.md)
- [Stage 4 tool registry / permission checker v1](./stage4.md)
- [Stage 5 session settings 与工作区默认值](./stage5.md)
- [Task Brief：planmode / full compaction 共用任务骨架](./task_brief.md)
- [Full Compaction：长任务第二阶段 checkpoint 设计](./full-compaction.md)
- [Product 1 日程管理能力](./product1.md)

## 阅读建议

- 想看当前真实运行架构，先回到 `docs/architecture/` 和代码实现，不要从阶段文档倒推现状
- 想理解某个能力为什么会这样设计，再读对应 stage 文档
- `product1.md` 属于专项 capability 文档，不代表整个仓库的默认产品身份

## 当前文档定位

- `stage1.md`：保留最早的 runtime 拆分草稿，主要用于回看概念起点
- `stage2.md` 到 `stage5.md`：保留已经落地过的阶段规格，适合核对设计意图和验收边界
- `task_brief.md`：说明当前已落地的 `task brief` artifact 行为，以及它与未来 `full compaction` 的演进边界
- `full-compaction.md`：保留未来 full compaction 的实现设计，建立在 `task_brief.md` 之上，不代表当前已落地实现
- `product1.md`：保留日程管理能力的专项设计与约束
