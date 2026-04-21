prompt -> agent loop -> tool call -> tool return -> agent loop

-> max turn -> final

-> decision -> final

1. agent loop

   loop state:

   running

   interrupted

   idle

   completed

   waiting for input

   waiting for tool result

   failed
2. prompt builder

   system prompt

   小心前缀问题，应该满足缓存的需要

   应该存储不频繁改变的内容

   context

   working directory
   messages

   tool schema
3. messages

   base type: conversation block ->

   user, assistant, tool call, tool result
4. session manager

   snapshot

   all messages

   session state

   input tokens count

   session recovery

   able to recover from snapshot
5. tool registry

   list tool

   get tool by name

   tool register
6. base tool

   name

   description

   execute

   is read only
7. tool state

   pending

   success

   failed
8. tools

   read_file

   list_directory

   search_text

stage 1:

目标：最小agentloop

验收标准：成功完成

思考-工具调用-回答的最小闭环

可以进行session的snapshot和recovery

有最小的三个工具调用

有prompt builder，满足缓存的需要

模型使用minimax 2.7， anthropic compatible

---

执行文档：

1. 先固定边界

   - `packages/agent` 负责最小 agent loop、prompt builder、session manager、tool registry 和工具抽象
   - `apps/api` 只负责对外暴露会话创建、执行触发、snapshot / recovery 之类的应用层接口
   - 当前设计不引入独立后台进程；若后续出现真实的长任务 / 异步 tool 场景，再单独补后台进程
   - 所有 prompt、状态机、工具协议尽量做成可测试的纯逻辑，不直接混在 app 入口里

2. 先实现数据模型，再实现流程

   - 定义 `conversation block` 作为消息基础类型，统一承载 `user`、`assistant`、`tool call`、`tool result`
   - 定义 `loop state`，至少包含 `running`、`interrupted`、`idle`、`completed`、`waiting for input`、`waiting for tool result`、`failed`
   - 定义 `tool state`，至少包含 `pending`、`success`、`failed`
   - 定义 session snapshot 结构，必须能保存 `all messages`、`session state`、`input tokens count`

3. 实现 prompt builder

   - system prompt 和动态上下文分层拼装，避免每次请求都把不变内容重写一遍
   - 稳定内容优先放在前面，减少前缀抖动，保证缓存命中更稳定
   - 动态部分只保留 `working directory`、messages、tool schema 等会变化的内容
   - prompt builder 先满足“能跑通最小闭环”，再考虑更复杂的指令拆分

4. 实现 tool registry 和最小工具集

   - 先做 `base tool` 抽象，字段至少包含 `name`、`description`、`execute`、`is read only`
   - tool registry 先支持 `list tool`、`get tool by name`、`tool register`
   - stage 1 只落地三个工具：`read_file`、`list_directory`、`search_text`
   - 三个工具都先按只读方式实现，确保 agent loop 的执行面尽量可控

5. 实现 session manager

   - 每次关键状态变化都能生成 snapshot
   - snapshot 必须支持恢复到上一次可继续执行的状态
   - 恢复时优先校验消息序列、当前 loop state 和 token 统计是否一致
   - 先保证“崩溃后能接着跑”，再做更细的增量持久化

6. 实现最小 agent loop

   - 流程固定为 `prompt -> agent loop -> tool call -> tool return -> agent loop`
   - 增加 `max turn -> final` 的硬退出条件，避免无限循环
   - 增加 `decision -> final` 的直接结束路径，支持模型一次回答完
   - 当模型要求调用工具时，先进入 `waiting for tool result`，工具返回后再回到 loop

7. 接入模型与 smoke test

   - 模型使用 `MiniMax-M2.7`
   - 通过 `Anthropic` compatible 方式接入，保证后续可复用同一套调用方式
   - 先用最小 smoke 验证模型连通性：发出 `pong` 请求并拿到稳定响应
   - smoke 通过后，再把模型调用接到 loop runner 和 tool 调用分支

8. 验收顺序

   - 先验证单次对话能正常产出 final answer
   - 再验证一次 tool call 往返能形成闭环
   - 再验证 snapshot 和 recovery 能恢复到可继续执行的状态
   - 最后验证三个工具都能被 registry 正确找到并执行

9. 本阶段不做的事

   - 不做复杂 UI
   - 不做多模型编排
   - 不做复杂记忆系统
   - 不做多轮任务规划器
   - 不把非核心的产品层能力提前塞进 runtime
