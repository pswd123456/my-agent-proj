# Stage 3: skill system v1

## 目标

- 为 runtime 增加一层轻量级 `skill system`，让 agent 能感知当前工作区内可用的技能说明。
- 第一版先落地 `skill metadata discovery + dynamic context injection`；当前实现已补上 `search_skill` / `load_skill` 作为按需读取入口，但仍不做 skill executor。
- skill 只向模型暴露 `name` 和 `description`，用于帮助模型更高效地选择已有能力、组织步骤和减少无效探索。

## 一句话定义

当 session 绑定某个 `workingDirectory` 时，runtime 会自动扫描该目录下的 `.agents/skills/`，读取每个 skill 的 `name` 和 `description`，并将这些信息注入到本轮动态上下文中；prompt 明确要求模型在需要时主动利用这些 skills，但不得编造未加载的 skill。若需要查看具体指令，模型再通过 `search_skill` / `load_skill` 按需读取，而不是把全部 skill 正文直接塞进上下文。

## 第一版边界

### v1 做什么

- 检测当前 `workingDirectory` 下的 `.agents/skills/` 目录
- 识别每个 skill 子目录中的 `SKILL.md` 或 `skill.md`
- 从 skill 文件中提取稳定的 `name` 和 `description`
- 将 skill 列表作为本轮 `runtime context` 注入 prompt
- 在 prompt 中加入“必要时主动利用 skills”的指令
- 提供 `search_skill` / `load_skill` 让模型按需读取 skill 正文
- 在 trace 中保留本轮实际注入过的 skills 信息，便于调试

### v1 不做什么

- 不把全部 skill 正文全文预加载到模型上下文
- 不执行 skill 内的脚本、命令或工具
- 不做远程 skill、marketplace、安装系统
- 不做多层级 `.agents/` 继承或 merge
- 不做数据库持久化；skills 仅从工作区文件系统派生
- 不把 skill 和 tool 合并成同一种抽象

## 目录与文件协议

第一版固定只支持当前 session `workingDirectory` 下的如下结构：

```text
<workingDirectory>/
  .agents/
    skills/
      <skill-id>/
        SKILL.md
```

兼容：

- `SKILL.md`
- `skill.md`

不兼容：

- 其他文件名
- 直接放在 `.agents/` 根目录下的 skill 文件
- 多层嵌套扫描

### 为什么先固定协议

- 避免 loader 一开始就变成“猜测型”逻辑
- 让 trace、调试和文档都更稳定
- 和当前基于 `workingDirectory` 的 runtime 模型保持一致

## skill metadata 协议

第一版不靠自然语言猜测标题和描述，而是固定读取文件头的 frontmatter：

```md
---
name: repo_reader
description: Read repository structure and summarize the relevant modules for the current task.
---
```

要求：

- `name` 必填，非空字符串
- `description` 必填，非空字符串
- 第一版只认这两个字段
- frontmatter 缺失或字段非法时，该 skill 直接忽略，并在调试日志/trace 中可见

这样做的原因：

- parser 稳定，避免读取整篇 markdown 猜测语义
- 便于后续增加更多 metadata 字段
- 便于明确区分“skill 存在但无效”和“skill 不存在”

## 运行时行为

### 1. skill discovery

- runtime 在构建 prompt 前，根据 `session.workingDirectory` 解析 `.agents/skills/`
- 仅扫描一级子目录
- 每个子目录最多识别一个 skill 文件：优先 `SKILL.md`，其次 `skill.md`
- 读取 frontmatter，构造成内存中的 `SkillDescriptor`
- 结果按 `name` 排序，保证 prompt 和 trace 稳定

建议数据结构：

```ts
export interface SkillDescriptor {
  name: string;
  description: string;
  relativePath: string;
}
```

说明：

- `relativePath` 不进入 prompt 注入文本，但会保留在内部、trace 以及 `search_skill` / `load_skill` 结果里，便于调试和精确读取

### 2. prompt 注入位置

skills 不进入 `system prompt`，也不进入稳定 `prefixMessages`。

第一版应放入 `runtimeContextMessages`，原因是：

- skills 来自 `workingDirectory`，属于运行时上下文
- 它们可能随工作区变化而变化，不应影响稳定前缀设计
- 这样更符合当前 `prompt` 的分层：稳定前缀负责缓存友好的固定信息，动态上下文负责本轮环境信息

建议注入格式：

```text
Runtime skills for this workspace:
- repo_reader: Read repository structure and summarize the relevant modules for the current task.
- test_helper: Suggest minimal validation steps for changed code paths.
```

如果没有 skills：

```text
Runtime skills for this workspace:
none
```

### 3. prompt 行为约束

在 prompt 中新增以下语义：

- 当当前任务和某个 skill 描述明显匹配时，应优先利用该 skill 提供的工作方式
- 只能使用当前 runtime context 中明确列出的 skills
- 不得编造、假设或引用未加载的 skill
- 如果没有匹配 skill，按默认推理和工具调用继续执行

可接受的 system prompt 增量示例：

```text
Actively utilize the skills listed in the runtime context when they are relevant to the user's request and can improve efficiency or reliability.
Only rely on skills explicitly listed in the current runtime context. Do not invent or assume unavailable skills.
```

### 4. trace 可观测性

第一版至少要保证：

- `prompt` trace 中能看到实际注入的 `runtimeContextMessages`
- 当某个 skill 因格式错误被忽略时，能在调试时定位

可选增强：

- 新增独立 `skills_loaded` trace event，结构化记录 `name`、`description`、`relativePath`

如果这一步先不单独建 event，也至少要让 prompt trace 足够清楚，能回答：

- 这次 run 到底发现了哪些 skill
- skill 没被用，是因为没发现，还是模型没选

## 模块落点建议

### `packages/agent/src/skills/`

新增 skill 相关实现，负责 discovery 和 metadata 解析：

- `types.ts`
  - `SkillDescriptor`
- `loader.ts`
  - 负责扫描 `.agents/skills/`
  - 负责定位 `SKILL.md` / `skill.md`
  - 负责解析 frontmatter
- `index.ts`
  - 对外导出

### `packages/agent/src/tools/`

- `search-skill.ts`
  - 负责按 `name` / `description` / `relativePath` 搜索已发现的 workspace skills
- `load-skill.ts`
  - 负责按 skill name 或 relative path 读取具体 `SKILL.md`

### `packages/agent/src/prompt.ts`

- 为 `PromptBuilder.build(...)` 增加 skills 输入
- 在 `runtimeContextMessages` 中拼装 skill 列表
- 更新默认 prompt 指令，增加 skill 使用约束

### `apps/api/src/index.ts`

- 不需要新增数据库或 API 协议
- runtime 直接基于 session 的 `workingDirectory` 读取 skills

## 建议实现步骤

1. 先定义 `SkillDescriptor`

- 只保留 `name`、`description`、`relativePath`
- 不提前加入 executor、script、examples 等字段

2. 实现 loader

- 输入：`workingDirectory`
- 输出：`Promise<SkillDescriptor[]>`
- 约束：
  - `.agents/skills/` 不存在时返回空数组
  - 无效 frontmatter 的 skill 跳过
  - 同名 skill 若同时出现，第一版直接按排序后保留第一个，并记录诊断信息

3. 接入 prompt builder

- `PromptBuilder.build(...)` 增加 `skills` 参数，或让调用方先构造 `skills`
- 新增 `createSkillsContextMessage(...)`
- 将 skills 作为 `runtimeContextMessages` 的一部分注入

4. 暴露按需读取工具

- 在 workspace tool pack 中注册 `search_skill`
- 在 workspace tool pack 中注册 `load_skill`
- 让模型先基于 metadata 选 skill，再按需读取 skill 正文

5. 更新默认 prompt

- 加入“主动利用 skills”的指令
- 加入“不得编造未加载 skill”的防幻觉约束
- 当工具存在时，引导模型用 `search_skill` / `load_skill` 读取具体指令

6. 更新 trace

- 确认 `prompt` trace 中能看到 skills context
- 如有必要，再补独立 event

## 验收标准

- 当 `workingDirectory/.agents/skills/` 不存在时，session 仍可正常运行
- 当存在合法 `SKILL.md` 时，prompt 的动态上下文中能看到对应 `name` 和 `description`
- 当 skill 文件缺少 frontmatter 或字段非法时，该 skill 不进入模型上下文
- 模型看到的 skill 列表仅包含当前工作区实际存在且合法的 skill
- 默认 prompt 明确鼓励在相关场景下使用 skills
- 默认 prompt 明确禁止编造未加载的 skills
- trace 能回放出本轮注入的 skills 信息

## smoke case

### case 1: no skills

工作区没有 `.agents/skills/`：

- prompt 中显示 `Runtime skills for this workspace: none`
- run 正常继续

### case 2: one valid skill

存在：

```text
.agents/skills/repo-reader/SKILL.md
```

内容：

```md
---
name: repo_reader
description: Read repository structure and summarize relevant modules before implementation.
---
```

期望：

- prompt 动态上下文出现 `repo_reader`
- trace 可见该信息

### case 3: invalid skill file

存在 `SKILL.md` 但没有合法 frontmatter：

- 该 skill 被忽略
- session 不报错中断
- 调试时可以知道该 skill 未生效

## 本阶段不做的事

- 不加载 skill 正文正文内容
- 不把 skill 变成 tool
- 不根据 skill 自动执行本地脚本
- 不做 skill 权限系统
- 不做跨工作区 skill 聚合
- 不做用户级全局 skill 覆盖工作区 skill 的继承规则

## 后续可扩展方向

- 支持从 skill 正文中按需摘取更细的 instruction 片段
- 支持 skill tags / capability matching
- 支持工作区级 skill 和用户级 skill 的分层合并
- 支持把 skill 和某些工具、模板、脚本做显式绑定
