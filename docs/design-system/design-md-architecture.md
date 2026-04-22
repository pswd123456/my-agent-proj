# DESIGN.md 契约层说明

## 目标

这份文档说明为什么仓库引入根目录 `DESIGN.md`，以及它和现有设计系统文档、运行时 token 实现之间的关系。

本次调整的核心不是“重写设计系统”，而是补一层更适合 AI、review 和自动检查消费的设计契约。

## 三层真相源

当前仓库的设计系统分成三层：

### 1. `DESIGN.md`

- 位置：仓库根目录
- 角色：agent-first 设计契约入口
- 面向对象：AI coding、设计 review、页面生成、自动化检查
- 内容特点：单文件、结构稳定、同时包含 token 摘要和设计 rationale

这里回答的是：

- 这个仓库整体是什么视觉方向
- 哪些颜色和排版层级最重要
- 新页面优先复用什么模板和组件模式
- 哪些做法应该被明确禁止

`DESIGN.md` 是“入口层”和“契约层”，不是最细粒度实现层。

### 2. `docs/design-system/`

- 位置：`docs/design-system/`
- 角色：人类可维护的详细说明层
- 面向对象：长期维护、专题拆分、协作解释

这里继续承担详细规则，例如：

- token 分类和准入规则
- 组件与 pattern 策略
- 页面模板定义
- AI 工作流
- 回归与验收约束

这层负责“为什么这样设计、规则如何细分、遇到例外怎么判断”。

### 3. `packages/tokens`

- 位置：`packages/tokens/src/index.ts`
- 角色：运行时视觉数值真相源
- 面向对象：实际 Web 实现、CSS 变量映射、组件消费

这层才是最终数值实现。`apps/web/app/layout.tsx` 会把这里的 foundation / semantic token 映射成 `--app-*` CSS 变量，页面和组件最终消费的是这套值。

所以当 `DESIGN.md` 和代码细节不完全一致时，应优先以运行时 token 为准，再同步修正文档。

## 去重原则

引入 `DESIGN.md` 之后，`docs/design-system/` 内的专题文档不应再重复承载以下内容：

- 整体品牌气质或视觉风格总述
- 主色、语气、组件气质的高层解释
- 已经进入 `DESIGN.md` 的全局禁止事项

专题文档应只保留：

- 实现层规则
- 结构层规则
- 流程层规则
- 验收层规则

也就是说，后续如果发现某段内容既能放在 `DESIGN.md`，又能放在专题文档里，默认优先保留在 `DESIGN.md`，专题文档只保留链接或更细的执行说明。

## 为什么不是直接用 `DESIGN.md` 取代现有设计系统

因为当前仓库已经有一套真实可运行的设计系统，而不是只有散乱样式。

现有实现已经包含：

- foundation / semantic 两层 token
- 页面模板和工作台模式
- `SessionRail`、`DebugInspector`、`ConversationWorkbench` 这类 repo-specific pattern
- AI 生成顺序和回归要求

如果直接把 source of truth 全部换成外部 `DESIGN.md` schema，会带来两个问题：

1. 当前更丰富的 token 结构会被压扁
2. 很容易产生第二套实现真相源

因此这次采用的是“上层契约化”，不是“底层替换”。

## 引入后工作流怎么变

引入 `DESIGN.md` 后，推荐工作流如下：

1. 做 UI 任务时，先读根目录 `DESIGN.md`
2. 如果涉及 token、组件、模板细节，再进入 `docs/design-system/` 的专题文档
3. 如果要改实际数值或 CSS 变量映射，最终落到 `packages/tokens` 和 Web 实现
4. 页面评审时，优先检查是否违反 `DESIGN.md` 的整体契约
5. 需要做更细回归时，再按 `docs/design-system/review-and-regression.md` 的要求补 Storybook、截图基线或其他检查

这样可以把“入口统一”和“实现精确”两件事同时保住。

## 稳定性提升点

这次引入 `DESIGN.md` 后，设计稳定性主要来自以下几点：

- AI 不需要每次自己拼接多份文档才能理解视觉方向
- 页面生成先受统一契约约束，再落到组件和 token 细节
- review 时可以先看是否偏离整体语言，而不是只盯具体样式值
- 后续可以接入 `@google/design.md` 的 `lint` / `diff` / `export` 能力，把部分设计规则转成自动检查

也就是说，稳定性提升并不来自“多了一份文档”，而来自“多了一份结构化、可被程序消费的文档”。

## 后续扩展建议

当前落地先保持克制，后续如果继续往前走，建议按这个顺序推进：

1. 增加 `DESIGN.md` lint 作为基础检查
2. 增加设计契约 diff，观察 token 或 prose 是否发生回归
3. 视需要补一层 `DESIGN.md -> token snapshot` 的同步检查，避免契约和实现长期漂移
4. 再考虑是否导出为 DTCG / Tailwind 供更多工具消费

不要一开始就让 `DESIGN.md` 直接生成或覆盖 `packages/tokens`。这个仓库更适合先把它用作契约层和校验层。
