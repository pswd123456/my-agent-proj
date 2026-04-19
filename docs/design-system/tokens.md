# Tokens 规范

## 目标

- 统一颜色、字号、间距、圆角、阴影、层级与动效
- 让设计和代码共享同一套视觉真相源
- 限制页面和组件里的魔法数样式

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

## 使用原则

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
