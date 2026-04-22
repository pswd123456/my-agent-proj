# Tokens 规范

## 说明

根目录 `DESIGN.md` 已经定义了当前设计系统的高层视觉契约。

本页不再重复说明品牌气质、主色语义或整体风格，只保留 token 实现层的规则：分类、分层、命名和新增准入。

## 分类

建议至少覆盖以下类别：

- `color`
- `typography`
- `space`
- `radius`
- `shadow`
- `border`
- `opacity`
- `motion`
- `z-index`
- `breakpoint`

## 分层

建议区分两层：

- 基础 token
- 语义 token

示例：

- 基础 token：`color.blue.600`
- 语义 token：`color.text.primary`
- 语义 token：`color.bg.surface`
- 语义 token：`color.border.subtle`
- 语义 token：`color.status.success`

## 实现原则

- 页面和组件优先使用语义 token
- 基础 token 只在 theme 映射或系统层使用
- 页面中尽量不出现裸 `hex`、裸 `px`、临时阴影值

## 命名规则

- 命名优先表达语义，而不是外观
- 避免与某个单一场景强绑定的命名
- 优先使用 `text.primary`、`surface.card`、`status.warning` 这类语义命名

## 新增 token 的准入

新增 token 前先判断：

1. 是否已有 token 可覆盖该需求
2. 是否只是单页面特例
3. 是否更适合通过组件 variant 解决
4. 是否需要同步到 Figma 变量

如果只是单页特例，不应新增全局 token。

## 与 `DESIGN.md` 的关系

- `DESIGN.md` 决定“该用什么视觉语言”
- 本页决定“这些视觉语言如何在 token 层落地”
- `packages/tokens/src/index.ts` 继续是实际运行时数值的最终真相源
