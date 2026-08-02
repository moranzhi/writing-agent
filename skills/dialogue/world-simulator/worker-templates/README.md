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
  "play_slots": { "gm": true, "narrator": true, "perspective": false, "chance": false },
  "workers": []
}
```

| 槽 | 默认 ref | 模板 |
|----|----------|------|
| gm | `world-simulator` | `world-simulator.yaml` — 裁决包 settlement.v1 |
| narrator | `narrator` | `narrator.yaml` — 只读裁决包写正文 |
| perspective | `role-decide` | `role-decide.yaml` — 可选知密视角 |
| chance（按需） | `chance` | `chance.yaml` — 程序骰子/抽签/比点；不进每轮管线 |

变量 / Progressive：**不是**独立 LLM 模板；见 `docs/progressive-data-design.md`（真值 + side_effects）。

## 其它文件

| 文件 | 说明 |
|------|------|
| `chance.yaml` | 机遇裁定（按需程序工具） |
| `round-present.yaml` | 结构化回合陈述（可选） |
| `opening-generator.yaml` | 开局生成器（创作末尾） |
| `outline.yaml` / `chapter-writer.yaml` | 扩写路径固定槽 |

## 用法

1. 世界模拟：勾选 `play_slots`，按需覆盖某 ref 的 context/outputs  
2. 扩写等：仍可用自由 `workers[]` 或另一套槽约定  
3. accept 后声明即实例规格
