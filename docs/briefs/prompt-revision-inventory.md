# 提示词 / 能力文档修订清单（待你改）

> 程序侧已落地：`play_slots`、`settlement.v1`、模板默认契约、前端友好渲染雏形。  
> **本清单只整理「可能需要你改的提示词/能力文」——此处不改正文，等你确认后再动。**

权威方法：`docs/progressive-data-design.md`、`docs/ui-glossary.md` §5.1。

---

## 优先级 P0（与固定槽 + 裁决包强相关）

| 文件 | 状态 |
|------|------|
| `modules/worker-spec/prompt.md` | **已改** → 游玩拓扑，只勾选固定槽 |
| `modules/refine/prompt.md` | **已改** → 按 `play_slots` 收成，禁发明 ref |
| `modules/catalog.yaml` / 配方 / `design-flow` | **已改**（配方含：挂谁可早、排第几须晚） |
| `modules/context-order/prompt.md` | **骨架已写**（`context-order.v1`） |
| `docs/context-fragment-design.md` | **已写**；范例技能已对齐 `context-fragment.v1` |
| 程序：片段解析 / 扁平投影序 / `对话.历史` 可投影 | **已落地**（非硬双锚） |
| `orchestrator.md` | **已改**：play 调度 auditor → perspective? → gm → narrator |

## 优先级 P1（能力归属 feeds）

| 文件 | 建议补什么 |
|------|------------|
| `modules/*/prompt.md` 的 `meta` | 统一加 `feeds: gm \| narrator \| runtime \| design_only \| perspective`（约定字段，程序以后可读） |
| `aesthetics-interaction` | `feeds: design_only`（再压缩进常驻）；呈现要点可摘要给 narrator |
| `mechanism` | **已改** output→`context-fragment.v1`；`feeds: gm` |
| `world-blueprint` | **已改**→「舞台骨架」+ `context-fragment.v1`；`feeds: gm` |
| `generation-rules` / `concrete-instances` | **已改**→`context-fragment.v1`；`feeds: gm`；宽原则+严外壳 |
| `narrative` | **已改**→「叙事指南与故事推进」；遣词/笔墨/禁忌+推进；`feeds: narrator` |
| `variable-design` | **已写**；核对 output 与 `tables.side_effects`、勿暗示「变量管理 worker」 |
| `variable-context` | **已写**；核对挂载对象用「主世界层/叙事转述」而非乱拆 |
| `reply-format` / `status-bar` | **已改**→正文组成 + 设计监控栏；`context-fragment.v1`；非程序报文 |
| `topology` | 骨架；若固定槽后可能降级为可选或删 |
| `worker-templates/*.yaml` | **程序已改** gm/narrator；`role-decide` 可再收紧「只出建议」 |

## 优先级 P2（文档口径）

| 文件 | 建议 |
|------|------|
| `docs/design-orchestrator-guide.md` | § 三大步 / Worker 创造：改为固定槽 + 创作上下文映射；保留表副作用 |
| `docs/world-simulator-modules.md` | 清单状态：worker-spec→拓扑；链到本清单 |
| `docs/tag-blackboard.md` | 强调 `运行.本轮.裁决` = settlement.v1；转述少读 `变量.当前` |
| `docs/skill-design-guide.md` | 若仍教「创造 worker」，加世界模拟例外 |
| `ui-glossary.md` | §5.1 已有主世界层；可补「游玩槽位」用户可见词（可选） |

## 明确不必改成「第三 Worker」的

- **变量管理**：保持 `variable-design` / `variable-context` + Runtime `side_effects`，不要新 `variable-update` 必选槽。  
- **世界观**：常驻挂 GM，不要世界观执行单元。  
- **性格分档**：Data + Progressive tag，不要性格 agent。

## 程序已做、提示词需跟上的契约

```json
// 设计.worker集（世界模拟）
{
  "play_slots": { "auditor": true, "gm": true, "narrator": true, "perspective": false },
  "tables": { "side_effects": [/* 来自变量设计 */] },
  "workers": [/* 可空，由程序按槽展开；或覆盖 context/outputs */]
}
```

```json
// 运行.本轮.裁决
{
  "schema": "settlement.v1",
  "player_action": "…",
  "resolved": ["…"],
  "visible_now": "…",
  "npc_moves": [{ "who": "…", "move": "…" }],
  "variable_changes": [{ "key": "好感", "delta": 8 }],
  "do_not_say": ["好感数字"],
  "tone_hint": "…"
}
```

```json
// 运行.本轮.旁观（多数轮空）
{
  "schema": "maintain.v1",
  "need_generate": false,
  "table_ops": [],
  "notes": []
}
```

## 建议你改的顺序

1. `refine` + `worker-spec`（或新拓扑技能）对齐 `play_slots`  
2. `world-simulator` 配方 + `orchestrator` 调度顺序  
3. 各能力 meta 补 `feeds`  
4. 骨架能力（status-bar / reply-format / topology）按需细写或降级  

改完后告诉我，我可以按你的口径改提示词并加解析 `feeds`（若要程序注入）。
