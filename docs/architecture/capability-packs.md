# 主线与能力包

## 当前主线

- 仓库主线定义调整为：一个面向个人助手场景的通用 `agent runtime`
- 默认优先支持工作区理解、文件操作、可观测执行和后续可扩展的助手型能力
- `日程管理` 不再作为整个仓库的默认产品身份，而是当前已经落地的第一个产品能力包

这样定义的原因很直接：

- `packages/agent`、`apps/api`、`packages/sdk`、trace、session 等底座本身并不天然只服务日程
- 仓库后续主线已经转向“个人助手 / 文件操作”，默认身份继续写成 schedule-first 会误导 prompt、文档和后续模块命名
- 但现有日程能力已经真实落地，不能靠一句“以后再说”把现状抹掉

## 分层定义

### 1. Core runtime

这层是仓库最稳定、最通用的部分：

- 模型调用与 provider 适配
- session 生命周期与持久化
- trace / SSE / 调试可观测性
- tool 调度与执行循环
- prompt 组装与缓存边界

这层的职责是“跑通 agent”，而不是绑定某个具体产品领域。

### 2. Capability pack

能力包是挂在 runtime 上的一组领域能力，可以包含：

- 一组 tool schema 与执行实现
- 对应的 prompt 增量约束
- 必要的数据访问依赖
- 专项文档与测试

当前仓库里，`日程管理` 应视为第一个已落地的 capability pack。

它可以继续使用当前的：

- `RoutineRepository`
- `create_routine` / `edit_routine` / `delete_routine`
- confirmation 相关等待流转

但这些都不再代表整个仓库的默认产品定位。

### 3. Skills

`skills` 继续保持当前 Stage 3 的定位：

- 从工作区动态发现
- 只向模型注入 `name` 和 `description`
- 用于提示“有哪些工作方式 / 约束 / 高效路径”
- 不直接等同于 tool executor 或 capability pack

换句话说：

- capability pack 是“系统实际挂了什么能力”
- skill 是“当前工作区建议模型怎么工作”

两者可以协同，但不应混成同一种抽象。

## 当前落地状态

截至现在，仓库处于一个“主线定义已调整、默认装配仍偏日程”的过渡状态：

- 文档与默认 prompt 应先按“通用个人助手 runtime”表述
- `apps/api` 当前默认装配仍然挂着日程相关 repository 与 tools
- 这意味着现阶段运行时仍然可以直接完成日程管理闭环
- 后续如果要把 capability pack 做成真正的按需装配，再继续下沉 registry / prompt fragment / app wiring

这个阶段先不强行把日程 tool schema 收成动态加载，是为了避免同时改动：

- tool registry
- API 装配
- prompt 语义
- 既有 smoke / UI / trace 预期

## 对后续实现的约束

后续新增“个人助手 / 文件操作”方向能力时，优先遵循下面的边界：

1. 默认身份写成通用助手，不把整个系统描述成某个单一产品
2. 产品领域规则尽量收在 capability pack，而不是散落进 runtime 默认层
3. prompt 的领域约束按“当前挂载了哪些能力”补充，而不是永久写死在基础 system prompt
4. `skills` 只做动态说明层，不承担真实执行编排
5. 历史上围绕日程管理写的专项文档应继续保留，但要明确它们是 capability-specific，而不是仓库总纲

## 当前建议阅读顺序

- 想理解仓库整体主线，先看 [项目概览](./overview.md)
- 想理解为什么“日程管理”现在属于能力包而不是总身份，看本文
- 想看具体日程能力怎么落地，再看 [`docs/plan/product1.md`](/Users/boneda/gitrepo/my-agent-proj/docs/plan/product1.md)
