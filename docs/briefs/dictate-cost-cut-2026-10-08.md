# 创作对话降本：取消同轮 retry + 2 轮 history

> 状态：已落地。承接 `token-cost-report-2026-10-06.md` / `prompt-cache-audit-2026-10-07.md`。  
> 记录：2026-10-08。

## 做了什么

1. **取消同轮 `fill-retry`。** fill 只打一枪；未通过项写入 `设计.对话落盘待补`（readTag，不进产物列表），checklist 标 **失败待补**，下轮 select/fill 自动并入。
2. **select / fill 更早对话默认只留 2 轮**（1 轮 = 一问一答，不含本轮末句）。可用 `DICTATE_HISTORY_TURNS` 或 `historyTurns` 参数改；负数 = 不限制。
3. **产物全黑板暂不动**（质量 / play 传导风险；内容侧优化另议）。
4. Gemini 路径上跨轮缓存 ROI 很低；本改动主攻 **少开枪 + 砍无用 history**，不为保缓存去裁产物。

## 验收

- 同书同对话长度：`fill-retry` 调用应接近 0；每轮模型调用中位趋向 **2**（澄清 1；缺 reply_user 时 lean reply 仍可能 3）。
- checklist 可见：待写 / 失败待补；失败回复含「失败待补（下轮继续）」。
- `DICTATE_HISTORY_TURNS=0` 时更早对话段应接近空。
