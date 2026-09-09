# Worker 可选模板（ref 默认契约）

## 定位

**不是** play 时加载的 `workers/*/SKILL.md`。  
**是** 写 `设计.worker集` 时合并的 **默认建议**：context、outputs、职责摘要。

| 层 | 权威来源 |
|----|----------|
| 本局 play 怎么跑 | 用户 accept 的 **`设计.worker集`**（优先 `play_slots` + workers） |
| 可选模板 | 本目录 `{ref}.yaml` — 未写全 `context`/`outputs` 时合并 |

Runtime 执行时读 Worker 集条目，不直接读本目录。

## 世界模拟固定槽（推荐）

规格里写 `play_slots`，由程序展开为 workers：

```json
{
  "play_slots": { "auditor": false, "gm": true, "narrator": false, "perspective": false },
  "workers": []
}
```

| 槽 | 默认 ref | 模板 |
|----|----------|------|
| auditor | `auditor` | `auditor.yaml` — maintain.v1；读本轮正文；默认空操作；无长对话史（默认关） |
| gm | `world-simulator` | `world-simulator.yaml` — 始终写 Markdown 故事正文；`play_slots.chance` 开时 harness 批量机遇工具 |
| narrator | `narrator` | `narrator.yaml` — 读主世界正文，提取/改写/镶壳（默认关） |
| perspective | `role-decide` | `role-decide.yaml` — 可选知密视角 |
| chance（拓扑开关） | `chance` | `play_slots.chance` 控制 gm harness；可选声明按需 `chance` ref 供显式 run_worker |

变量 / Progressive：**不是**独立 LLM 模板；见 `docs/progressive-data-design.md`（真值 + side_effects）。  
Runtime：写入 `运行.本轮.旁观` 时按需合并 `table_ops`；遗留 `运行.本轮.裁决` 仍可合并 `variable_changes`（兼容旧存档）。

## 其它文件

| 文件 | 说明 |
|------|------|
| `chance.yaml` | 机遇裁定（按需 run_worker 或 gm harness 共用程序实现） |
| `round-present.yaml` | 结构化回合陈述（可选） |
| `opening-generator.yaml` | 开局生成器（创作末尾） |
| `outline.yaml` / `chapter-writer.yaml` | 扩写路径固定槽 |

## 用法

1. 世界模拟：勾选 `play_slots`，按需覆盖某 ref 的 context/outputs  
2. 扩写等：仍可用自由 `workers[]` 或另一套槽约定  
3. accept 后声明即实例规格
