# novel-standard（TODO）

## 定位

标准小说创作流水线（见 `docs/skill-format.md` 示例）：卷/章结构、大纲 → 正文，tag 驱动、阶段清晰。

## 与 interactive-novel / quick-write

| 包 | 侧重 |
|---|---|
| quick-write | 全量 LLM，几乎无 tag 设计 |
| interactive-novel | 用户高参与、多轮确认 |
| novel-standard | 结构化长篇，worker 分工明确 |

是否保留独立包，或与 `interactive-novel` 合并，实施前再定。

## 下一步

- [ ] 确认是否与 interactive-novel 合并
- [ ] 写 `orchestrator.md` + workers/
