# Worker 可选模板（ref 默认契约）

## 定位

**不是** play 时加载的 `workers/*/SKILL.md`。  
**是** 谈【剧本】、写 `设计.worker集` 时合并的 **默认建议**：context、outputs、职责摘要。

| 层 | 权威来源 |
|----|----------|
| 本局 play 怎么跑 | 用户 accept 的 **`设计.worker集`** |
| 可选模板 | 本目录 `{ref}.yaml` — 未写全 `context`/`outputs` 时合并 |

Runtime 执行时读 Worker 集条目，不直接读本目录。

## 文件

| 文件 | 说明 |
|------|------|
| `world-simulator.yaml` | 世界推进 / 裁决 |
| `narrator.yaml` | 转述 / 展示 |
| `role-decide.yaml` | 单角色决策 |
| `round-present.yaml` | 结构化回合陈述 |
| `opening-generator.yaml` | 开局生成器（创作末尾） |
| `outline.yaml` | 大纲 / 细纲 |
| `chapter-writer.yaml` | 章节正文 |

## 用法

1. 按用户意图选 `ref`
2. 读 `{ref}.yaml` 填默认字段
3. 用户特殊需求覆盖后写入 Worker 集
4. accept 后声明即实例规格
