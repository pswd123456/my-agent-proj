# UI 一致性概览

这份文档改为设计系统入口页，详细内容已拆分到多个专题文档。

## 核心结论

纯 AI coding 想保持页面之间长期统一，核心不是依赖模型“记住风格”，而是建立受约束的系统。

最关键的五层约束：

1. `Design Tokens`
2. `Component Library`
3. `Page Templates / Patterns`
4. `AI Instructions / Prompt Workflow`
5. `Visual Regression / Documentation`

## 本项目的统一性定义

- 相同信息层级使用相同的排版层级
- 相同语义状态使用相同的颜色、图标、文案语气
- 相同任务类型使用相同的页面结构
- 相同交互动作在不同页面有一致反馈
- 新页面优先复用现有模板与组件，而不是新造结构

## 详细文档

- [Tokens 规范](./tokens.md)
- [组件与 Patterns 策略](./components-and-patterns.md)
- [页面模板](./page-templates.md)
- [AI 生成工作流](./ai-workflow.md)
- [回归与验收](./review-and-regression.md)
