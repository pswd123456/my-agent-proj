# AGENTS.md

作用域：`packages/agent/src/` 及其子目录。

## 源码分层

- `src/` 只放 `packages/agent` 的源码实现、内部适配层与对外入口
- 顶层文件优先保留为入口或 barrel，具体实现下沉到子目录
- 单个文件只承载一个清晰职责，避免把契约、实现、工具函数和导出入口混写
- 共享逻辑优先放在就近的 `shared`、`contracts` 或对应模块目录中
- 模块变大时，优先先拆小文件，再考虑新增子目录

## 当前职责边界

- `runtime.ts` 负责 agent 执行编排
- `prompt.ts` 负责 prompt 拼装与消息转换
- `session/` 负责 session 契约、校验与存取实现
- `tools/` 负责 tool registry 与具体工具实现
- `model.ts` 负责模型协议适配

## 维护约定

- 新增长期有效的目录或分层规则时，优先更新本文件
- 目录边界变化时，先更新规则，再调整代码导出与 import
