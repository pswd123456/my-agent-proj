# UI 一致性概览

这份文档不再重复描述仓库的整体视觉语言。

当前 UI 一致性的最高层契约以仓库根目录 `DESIGN.md` 为准；本目录只保留实现层、流程层和验收层的专题细则。

## 当前分工

- `DESIGN.md`：整体视觉方向、组件语气、页面主模板、禁止事项
- `tokens.md`：token 分类、分层、命名与准入
- `components-and-patterns.md`：组件复用边界与 repo-specific patterns
- `page-templates.md`：页面模板矩阵与结构骨架
- `ai-workflow.md`：AI 生成页面时的执行顺序
- `review-and-regression.md`：回归、验收与漂移检查

## 使用方式

- 先读根目录 `DESIGN.md`
- 再根据任务进入最相关的专题文档
- 如果专题文档和 `DESIGN.md` 的高层描述重复，应优先保留 `DESIGN.md`，专题文档只保留可执行细节
