1. 实现多轮对话，按input token默认限制max input tokens（context）上限为200k， 超过则报错，暂时不做compaction
2. 将yolo mode/cwd设置从session创建时的前端ask剥离开，不再弹窗ask，采用settings的配置
3. 新增一个settings持久化层，预留userid字段，yolo/cwd/context window/max turns在这里配置，注入到会话层
4. 在根目录创建一个agent-workspace默认cwd是这个目录
5. max_turns缩短到一次assistant对话中的数量，即用户prompt-assistant tool call-final 之间算一次完整对话，默认值为50