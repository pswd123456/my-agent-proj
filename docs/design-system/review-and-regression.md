# 回归与验收

## 目标

- 把 UI 一致性从“依赖记忆”变成“可自动检查”
- 及时发现 AI 改动带来的视觉漂移

## 建议工具

- `Storybook`
- `Autodocs`
- `Chromatic` 或 Storybook visual tests
- `Playwright` screenshot baselines

## Storybook 要求

每个组件至少应覆盖：

- `default`
- `loading`
- `empty`
- `error`
- `dense`
- `mobile`

页面模板也应进入 Storybook，而不只是基础组件。

## UI PR Checklist

- 是否复用了现有 page template
- 是否优先复用了现有组件
- 是否引入了新的魔法数样式
- 是否直接写了裸颜色或裸阴影
- 是否改变了相同类型页面的标题层级
- 是否改变了相同语义状态的颜色或图标
- 是否补充了对应的 Storybook story
- 是否需要更新模板文档或组件文档
- 是否需要新增视觉回归基线

## 漂移信号

以下现象通常说明页面开始漂移：

- 同类页面的页头结构不一致
- 相同按钮在不同页面尺寸和语义不同
- 同类列表的间距和密度不一致
- 同一业务状态在不同页面使用不同颜色
- 组件 props 越来越多，但复用没有变高
