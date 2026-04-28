# Product 1: 日程管理 Agent

## 目标

先做日程管理方向，交付一个可以把用户的自然语言安排转成结构化日程、在无冲突时自动落库、在创建 overlap 时直接报错、并支持后续查询与修改的最小产品闭环。

这份文档对应的是“第一个具体产品层能力”，它建立在已有的 `agent runtime` 规划之上，但关注点不再是通用 loop，而是：

- 用户到底输入什么
- agent 需要产出什么
- tool 怎么设计才稳定
- session 和数据怎么持久化
- 第一版什么必须做，什么先不做

## 一句话定义

用户输入一段自然语言的日程意图，agent 将其整理成当天或指定日期的结构化安排；如果没有冲突就直接写入数据库，如果创建时发生 overlap 就直接返回错误，并支持后续查改删。

## 核心用户问题

用户经常不是按结构化表单录入日程，而是直接说一段混合了时间、事项、时长、偏好和模糊表达的话，例如：

> I got a meeting this morning 10 am, then go rest, got another one around 2pm, gotta pick kid at 5, entertainment for 2hrs, sleep at 10. tomorrow wakeup at 7. and i like to read for 2hrs, also i had to reply my email, find some time for it

这类输入的问题在于：

- 时间表达混杂，包含精确时间和模糊时间
- 事项中既有固定约束，也有可浮动任务
- 用户未必会主动补齐缺失字段
- 直接让用户手动填写多条表单会破坏体验

因此产品的第一价值，不是“做一个日历 CRUD 界面”，而是“把自然语言安排转成可自动执行、创建冲突时可直接报错、可编辑、可持久化的结构化日程”。

## v1 产品闭环

### 用户输入

用户直接输入自然语言描述，默认允许包含：

- 当天或未来某天的安排
- 一个或多个固定时间事件
- 一个或多个弹性任务
- 睡觉、起床、休息、娱乐、阅读、回邮件之类生活事项
- 模糊时间表达，如 `around 2pm`、`this morning`、`tonight`

如果用户没有显式提供日期，默认按“今天”处理。

### agent 行为

agent 的核心任务是先判断是否能安全落地，再决定直接写入还是先确认：

1. 解析用户输入中的时间约束、时长、偏好和冲突
2. 判断新安排是否与已有日程冲突
3. 无冲突则直接写入；如果创建新日程时发生 overlap，则直接报错；只有修改覆盖、删除歧义或高风险推断时才发起确认

### 最终返回

第一轮返回分成三类：

- 无冲突：直接返回“已创建/已修改”的纯文本结果
- 创建 overlap：直接返回“冲突说明 + 改期提示”
- 需要确认：返回“确认说明 + 候选安排 + 确认请求”

无冲突时的理想输出形态：

> 已帮你安排今天的日程：  
> 10:00-11:00 meeting  
> 11:00-14:00 rest  
> 14:00-15:00 meeting  
> 15:00-17:00 reply email  
> 17:00-18:00 pick kid  
> 18:00-20:00 entertainment  
> 20:00-22:00 reading  
> 22:00-07:00 sleep

创建 overlap 时的理想输出形态：

> 无法创建这条日程：  
> 你要安排的 14:00-15:00 meeting  
> 和现有的 14:00-15:00 dentist overlap。  
> 请换一个时间，或先修改 / 删除现有日程。

只有当出现修改覆盖、删除歧义或明显高风险推断时，agent 才需要向用户确认后再调用写入类 tool。

## 产品边界

### v1 必做

- 自然语言解析为结构化日程
- 无冲突时自动创建日程
- 创建 overlap 时直接报错，不进入确认
- 对修改覆盖、删除歧义等场景保留确认流程
- 支持查询指定日期或一周内日程
- 支持修改已有日程
- 支持删除已有日程
- 将 session 和 routine 数据持久化到 `PostgreSQL`
- 为成功和失败都定义稳定的结构化输出
- 提供纯文本 CLI 交互，直接打印工具调用结果

### v1 不做

- 不做复杂日历 UI
- 不做多人共享日程
- 不做时区自动推断和跨时区协同
- 不做 recurring rules，例如“每周一重复”
- 不做复杂优化器，例如自动求解全局最优排程
- 不做外部日历同步，例如 Google Calendar / Apple Calendar

## 核心交互原则

### 1. 无冲突自动写入，创建 overlap 直接报错

这条在本产品里不再作为全局默认。新的规则是：

- 无冲突时，允许 agent 直接创建或修改
- 创建新日程时若与已有 routine overlap，直接报错，不静默覆盖，也不进入确认
- 只有修改覆盖、删除歧义或高风险推断时，才先确认再写入

### 2. 固定约束优先

类似 meeting、接孩子、睡觉这种明确时点或强约束事件，优先级高于“找时间做邮件/阅读/娱乐”这类弹性任务。

### 3. 缺失字段用默认值，但必须可解释

例如：

- `duration` 默认 `1 hour`
- 未提供日期时默认 `today`
- 未提供描述时允许为空

但 agent 在输出里应让用户知道自己做了什么默认推断。

### 4. 模糊理解必须显式外化

对于 `this morning`、`around 2pm` 这类模糊表达，agent 可以先做合理推断；如果推断后的安排无冲突，可以直接落地，但返回文本里必须体现默认推断；如果推断后的创建安排与已有日程 overlap，则直接报错；如果涉及修改覆盖或其他高风险推断，则进入确认流程。

### 5. 冲突优先暴露，不静默覆盖

如果新安排与已有 routine 冲突，默认不静默覆盖原安排，而是先告诉用户冲突发生在哪里，再请用户确认是否覆盖、改排或取消。

## Tool 设计

当前产品建议删除原来的三个通用产品层 tools，改成围绕日程管理的专用 tools。

### v1 tools

#### `create_routine`

用途：创建一条日程。

建议入参：

- `name`: 日程标题，必填
- `description`: 详情，可选
- `date`: 目标日期，必填，格式 `YYYY-MM-DD`
- `start_time`: 开始时间，可选，格式 `HH:mm`
- `end_time`: 结束时间，可选，格式 `HH:mm`
- `duration_minutes`: 时长，可选；若未提供，默认 `60`
- `source`: 来源，固定为 `user_confirmed` 或 `agent_suggested_confirmed`

约束：

- 至少要有 `start_time + end_time` 或 `start_time + duration_minutes` 其中一种组合
- 写入前要做时间合法性与冲突校验
- 若与已有日程 overlap，直接返回错误，不进入确认流程

#### `edit_routine`

用途：修改一条已有日程。

建议入参：

- `routine_id`: 必填
- `name`: 可选
- `description`: 可选
- `date`: 可选
- `start_time`: 可选
- `end_time`: 可选
- `duration_minutes`: 可选

约束：

- 至少要有一个可修改字段
- 修改后同样需要重新做时间合法性和冲突校验

#### `delete_routine`

用途：删除一条已有日程。

建议入参：

- `routine_id`: 必填
- `reason`: 可选，便于审计

约束：

- 删除前最好由 agent 先复述目标，避免误删

#### `search_routine_by_oclock`

用途：根据时间点或时间范围查找附近日程。

说明：

- 这个名字先沿用当前草稿，便于快速落地
- 如果后续统一命名风格，可再改成更明确的 `search_routine_by_time`

建议入参：

- `date`: 必填
- `time`: 可选，格式 `HH:mm`
- `time_range`: 可选，形如 `{ start: "13:00", end: "15:00" }`

输出用于支持用户说：

- “我下午两点左右有什么”
- “帮我看看 5 点前后安排”

#### `list_routine_by_week`

用途：列出一周视角的日程。

建议入参：

- `week_start_date`: 必填，格式 `YYYY-MM-DD`

#### `list_routine_by_date`

用途：按日期或日期范围列出日程。

建议入参：

- `date_range`: 必填，格式 `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }`

如果只是查某一天，`start` 和 `end` 相同即可。

#### `ask_for_confirmation`

用途：当出现修改覆盖风险、删除歧义或高歧义场景时，把候选日程整理成纯文本确认消息，等待用户反馈。

建议入参：

- `summary_text`: 给用户看的自然语言摘要
- `proposed_items`: 候选日程列表
- `context_note`: 可选，用于解释默认推断或不确定点
- `conflict_items`: 可选，列出冲突的已有日程

说明：

- 这个 tool 本质上是产品交互工具，不一定需要真的访问数据库
- 第一版输出形态先是纯文本 CLI，不做按钮或卡片 UI
- 它的价值是把“等待用户确认”变成一个显式状态，而不是靠 prompt 暗约定

## Tool 返回结构

所有 tools 都应使用统一响应 schema，避免模型面对不同工具时需要猜字段。

建议统一为：

```ts
type ToolResult<T> = {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
  validationErrors?: Array<{
    field: string;
    issue: string;
  }>;
};
```

### 成功示例

```json
{
  "ok": true,
  "code": "ROUTINE_CREATED",
  "message": "Routine created successfully.",
  "data": {
    "routine_id": "rt_123",
    "date": "2026-04-21",
    "start_time": "10:00",
    "end_time": "11:00"
  }
}
```

### 失败示例

```json
{
  "ok": false,
  "code": "INVALID_TIME_RANGE",
  "message": "end_time must be later than start_time.",
  "validationErrors": [
    {
      "field": "end_time",
      "issue": "must be later than start_time"
    }
  ]
}
```

这点很重要，因为 validator 和 agent loop 都会依赖稳定 schema 来判断：

- 是业务失败还是系统失败
- 是否可以请模型重试
- 是否应该转成用户可理解的澄清消息

## Validator 角色

当前草稿里的这句是对的，需要保留并落到实现边界上：

> validator: if tool call schema not valid generate a messages for model

更准确地说，v1 需要一个独立 validator 层，负责在 tool 真执行前做 schema 校验。

### validator 职责

- 校验 tool 名称是否合法
- 校验入参 schema 是否完整
- 校验日期、时间、时长格式
- 生成结构化错误信息返回给模型
- 不让非法 tool call 直接打到数据库

### validator 返回后的 agent 行为

如果 tool call 不合法，agent 不应该崩溃，而应该进入“纠正性回复”路径，例如：

- 请模型基于 validator 错误重新组织 tool call
- 或直接向用户发澄清问题

## 会话与持久化

### 为什么需要 PostgreSQL

这个产品不是纯 stateless chat，因为它至少有两类需要持久化的信息：

- 无冲突时自动创建的日程数据，以及有冲突时确认后创建的日程数据
- agent session 本身的对话与等待状态

因此需要拉起一个 `PostgreSQL`，并把 routine 和 session 都存进去。

### 建议持久化对象

#### routines

- `id`
- `user_id`
- `name`
- `description`
- `date`
- `start_time`
- `end_time`
- `duration_minutes`
- `status`
- `source`
- `created_at`
- `updated_at`

说明：

- 保留 `user_id` 字段，为多租户演进留口
- v1 当前不做鉴权，只按单用户 CLI 场景实现

#### sessions

- `id`
- `user_id`
- `status`
- `current_date_context`
- `working_directory`
- `model`
- `yolo_mode`
- `context_window`
- `max_turns`
- `enabled_capability_packs`
- `active_background_task_count`
- `pending_permission_request`
- `pending_confirmation_payload`
- `pending_user_question_payload`
- `pending_background_notifications`
- `todo_state`
- `full_compaction_state`
- `pending_conflict_summary`
- `first_user_message`
- `last_user_message`
- `loop_state`
- `turn_count`
- `last_error`
- `pending_tool_call_ids`
- `interrupt_requested`
- `history_compactions_since_full_compaction`
- `prompt_cache_key`
- `created_at`
- `updated_at`

说明：

- `current_date_context` 仍是 session 持久化字段，主要供日程默认日期和 UI 使用；它不再默认注入 prompt，模型需要当前日期或时间时应调用 `get_current_time`
- 当前真实字段以 `packages/db/src/schema.ts` 的 `agent_sessions` 为准

#### session_messages

- `id`
- `session_id`
- `role`
- `content`
- `tool_name`
- `tool_call_id`
- `created_at`

### 状态建议

session 至少需要区分：

- `running`
- `waiting_for_conflict_confirmation`
- `waiting_for_user_input`
- `completed`
- `failed`

对于本产品，`waiting_for_conflict_confirmation` 是必须显式建模的状态，因为第一版的确认只在冲突场景出现。

## Agent 决策规则

### 何时直接调用写入类工具

下面两种情况允许直接写入：

1. 用户明确说“帮我创建一个 10 点到 11 点的会议”
2. agent 基于用户自然语言整理出安排，并确认与当前已有日程无冲突

### 何时必须先确认

以下情况必须先走确认：

- 修改操作会覆盖原有 routine
- 删除目标不明确，可能误删
- agent 无法在不牺牲已有约束的前提下直接落地

对于“创建新日程时与已有日程 overlap”，不走确认，直接返回错误。

### 何时应回问用户

以下情况不应强行安排，而应先澄清：

- 日期不明确，且用户话里可能同时提到了今天和明天
- 固定事件之间没有足够空档，且用户也没有表达接受覆盖或替换
- 重要字段冲突，例如同时要求 14:00 开会和 14:00 休息
- 用户说法不足以形成任何有效时间区间

## System Prompt 改写要求

当前产品层 system prompt 需要按这个场景重写，重点不是“一个通用 agent”，而是“一个会安排日程且知道何时确认、何时澄清、何时落库的 agent”。

至少要覆盖这些规则：

- 默认日期上下文是今天
- 默认时长是 1 小时
- 对模糊时间可以合理推断，但必须外化给用户
- 无冲突时可以直接写入 create/edit
- 创建 overlap 直接报错，不调用确认流程
- 只有修改覆盖、删除歧义或高风险歧义时才调用确认流程
- 尽量优先整理成完整安排，而不是每缺一个细节就立刻打断用户
- 当 tool schema 不合法时，应根据 validator 返回修正调用
- 输出给用户的确认消息必须清楚列出每个时间段和冲突点
- CLI 模式下，优先输出纯文本工具调用结果，不依赖 UI 组件

## CLI 交互形态

第一版先做纯文本 CLI，不做按钮、卡片或图形化日历。

### 目标

- 让 model 返回工具调用
- 执行工具后，把工具调用结果打印成纯文本
- 用户直接在 CLI 中继续补充或修正
- 第一版先验证“tool call 能跑通并能看懂结果”，再考虑更自然的用户态润色

### 推荐输出风格

无冲突创建成功时：

```text
[create_routine] success
- 2026-04-21 10:00-11:00 meeting
- 2026-04-21 14:00-15:00 meeting
- 2026-04-21 17:00-18:00 pick kid
```

创建 overlap 直接报错时：

```text
[create_routine] conflict detected
- 2026-04-21 14:00-15:00 dentist
- action needed: choose another time or edit/delete the existing routine first
```

这个输出不要求是最终用户态文案，但要足够稳定、可读、便于调试。

## 建议的最小执行流程

```text
user prompt
-> parse intent and constraints
-> decide whether clarification is needed
-> check conflicts against existing routines
-> if no conflict: create_routine or edit_routine directly
-> if create overlap: return error and ask user for another time
-> if overwrite-risk edit / ambiguous delete / high-risk inference: ask_for_confirmation
-> user confirms / rejects / amends
-> create_routine or edit_routine or delete_routine
-> final response
```

## 里程碑

### Milestone 1: 产品闭环跑通

- 接入日程管理专用 tools
- 能根据自然语言生成结构化安排
- 能检查是否与已有日程冲突
- 无冲突时能直接创建 routines
- 创建 overlap 时能直接报错
- 对修改覆盖、删除歧义等场景能发出确认请求

验收标准：

- 一段复杂自然语言输入可以整理成结构化日程
- 无冲突时，日程自动写入数据库
- 创建 overlap 时，不自动写入，直接返回错误
- 对修改覆盖、删除歧义等场景，进入确认流程
- CLI 可以直接打印工具调用的纯文本结果

### Milestone 2: 查询与修改

- 支持按日期查询
- 支持按周查询
- 支持按时间点查询
- 支持 edit 和 delete

验收标准：

- 用户可以自然语言发起“看看我今天安排”“把 2 点会议改到 3 点”“把那条阅读删掉”

### Milestone 3: 稳定性与可观测性

- validator 完整接入
- session 状态可恢复
- 关键 tool call 和确认动作可追踪

验收标准：

- 非法 tool call 不会直接执行
- 中断后能恢复 pending conflict confirmation 状态
- 可以定位一次失败是解析错误、校验错误还是数据库错误

## 默认假设

- v1 优先服务单用户或单 session 视角，但数据层保留多租户字段
- 时间粒度先按分钟即可，不处理秒级
- 日期与时间默认使用当前用户本地时区
- 候选安排的优化规则先保持简单：固定约束优先，弹性任务按空档顺序填充

## 待后续补充但当前不阻塞实现的问题

- 是否需要区分 hard event 和 flexible task 两类实体
- 是否需要单独存储 agent proposal，而不是只存 confirmed routine
- 是否要支持“只生成建议，不入库”的模式
- `search_routine_by_oclock` 是否在第二轮统一重命名
- 是否需要为确认消息设计专门的 UI schema，而不只是纯文本 CLI 输出

## 实现优先级建议

如果只做最小可用版，建议顺序是：

1. 先把 `create_routine`、`list_routine_by_date`、冲突检查 跑通
2. 再补 `edit_routine`、`delete_routine`
3. 再补 `ask_for_confirmation`、`list_routine_by_week` 和 `search_routine_by_oclock`
4. 最后补 validator、session recovery 和更完整的 prompt 约束

这样可以最快验证最核心的一句话价值：

“用户说一段自然语言，agent 能在无冲突时自动安排并落库，在创建 overlap 时直接报错，在需要确认的高风险场景再进入确认流程。”
