# 直聊

与作品工作台「对话」并列的轻量多轮 LLM 面。请求始终由预设夹心包裹；不改动设置里的预设「试跑」。

## 两层

| 层 | 含义 | 落盘 |
|----|------|------|
| L1 上下文壳 | 系统提示、史前设定、种子历史、史后、尾注；可选绑定 `presetId`（缺省用全局选用预设） | `~/.writing-agent/direct-chats/shells/` |
| L2 会话 | 该壳下的多轮消息；助手消息可带 `contextTrace` 供对比 | `.../conversations/` |
| 临时会话 | 未选存档时的默认快速对话 | 仅浏览器 `localStorage`，最多 **2** 条；可「保存」升为持久 L1+L2 |

面包屑：`直聊 › {壳名\|临时} › {会话名}`。入口页：`/chat.html`。未选任何存档时中间即是快速对话，无单独「快速对话」按钮。

## 多模型窗口（竞技场）

- 标题栏「新增窗口」：中间按模型分栏（LMSYS Arena 式 side-by-side），每列独立对话流。
- 同一用户句在各列各显一份；发送时所有列并行 completion。
- 列内「保留此回复」：写入该轮 `selectedWindowId`；之后各列发下一轮时，本轮助手侧都以该回复进历史。
- 未保留：各列继续用自己的回复拼 prior。

## 请求

- 槽位 → WorldInfoPack；`chatHistory` = 种子历史 + 已落定多轮 transcript；本轮用户输入进 turn。
- 经 `PresetLlmProvider` 按选用/壳绑定预设夹心后发模型。
- 无选用预设：拒绝发送。
- 无 API Key：可只返回拼装结果。

## 多模型

助手消息保留 `contextTrace` 时，可对多个 API 配置并行重放，再「采用」写入 variants / branchIndex。临时会话需先保存再对比。

## API（节选）

- `GET/POST /api/direct-chat/shells`
- `GET/PATCH/DELETE /api/direct-chat/shells/:id`
- `POST /api/direct-chat/shells/:id/conversations`
- `GET/PATCH/DELETE /api/direct-chat/conversations/:id`
- `POST /api/direct-chat/conversations/:id/messages`
- `POST /api/direct-chat/ephemeral/complete`
- `POST /api/direct-chat/promote`
- `POST .../messages/:mid/compare`、`.../compare/adopt`
