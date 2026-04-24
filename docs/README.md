# 文档索引

当前文档按主题拆分，避免单篇过长。

## 入口

- [设计契约入口](../DESIGN.md)
- [模板初始化](./template/README.md)
- [技术栈总览](./tech-stack.md)
- [架构文档目录](./architecture/README.md)
- [主线与能力包](./architecture/capability-packs.md)
- [设计系统总览](./design-system/README.md)

## 使用建议

- 做 UI、视觉统一、AI 生成页面相关工作时，先看根目录 `DESIGN.md`，再进入 `docs/design-system/`
- 刚复制模板时，先看 `docs/template/`
- 做技术栈、工程结构、架构边界相关工作时，从 `docs/architecture/` 开始
- 如果要判断“仓库主线是什么、哪些只是专项能力”，优先看 `docs/architecture/capability-packs.md`
- 做 UI、一致性、tokens、组件策略、页面模板相关工作时，从 `docs/design-system/` 开始
- 若某项约定已经沉淀为专题文档，后续应优先更新专题文档，而不是把补充内容继续加回入口页
- `docs/plan/` 主要保留阶段规划和历史实现笔记，适合回看演进过程，不是当前架构的首选入口
