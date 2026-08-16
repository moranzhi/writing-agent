# 世界模拟器 · 编排器与能力撰写清单

> 给作者用。用户侧术语：**`docs/ui-glossary.md` §0**。  
> 运行：选配方 → 编排**增量**工作流计划 DAG → `design-step` 执行技能；可再扩步反复调用。  
> **标准范例**：`modules/aesthetics-interaction/prompt.md`。  
> **真值 / Data / Progressive（变量与门控）**：**`docs/progressive-data-design.md`**。  
> **上下文片段 / 槽位 / 投影排序**：**`docs/context-fragment-design.md`**。  
> **游玩呈现壳**：**`docs/play-presentation-shells.md`**（预览页 `/shells.html`）。  
> **主世界层↔旁观怎么配合**：**`docs/play-dm-auditor.md`**。  
> **提示词待改清单**：**`docs/briefs/prompt-revision-inventory.md`**。  
> **给外部 AI 的完整泛用规范**：**`docs/briefs/capability-authoring-brief.md`**（含 `context-fragment.v1`）。

## 两层

```text
【配方】recipes/     【技能】modules/
        └─ 编排增量 DAG → design-step 注入技能块 →（open 则再编排）→ 执行单元上场
```

---

## 能力文档格式（程序可切割）

每个能力 = `modules/{id}/prompt.md` + `catalog.yaml` 一行。

程序**只认 fence 语言标签**切割，不认散文/`##` alone：

| 块 id | 必填 | 用途 |
|-------|------|------|
| `meta` | 建议 | YAML：name / id / artifact / declaration / when / when_not / boundary |
| `opening` | 可选 | **默认问题**正文。开局：配方 `steps` 已预置进「设计.创作流程」，用户首句即坐在 DAG 第一步；若「用户.需求」已有内容，程序**跳过**再抛 opening，直接进本步 LLM |
| `task` | 是 | 本步任务与验收边界 |
| `principles` | 建议 | 原则 |
| `probe` | 建议 | 追问策略 |
| `output` | 是 | 产物形状（多为 JSON） |
| `checklist` | 建议 | 自检 |
| `examples` | 可选 | 好/坏对照 |

````markdown
# 能力中文名

## meta
```meta
name: …
id: …
artifact: 设计.…
declaration: …
```

## opening
```opening
（用户看到的开场白；可省略整块 = 本步直接调 LLM）
```

## task
```task
…
```

## principles
```principles
…
```

## probe
```probe
…
```

## output
```output
{ … }
```

## checklist
```checklist
- [ ] …
```
````

切割实现：`parseModulePromptSections` / `extractModuleOpening` / `formatModulePromptForLlm`（`src/skills/creation-flow.ts`）。  
注入 LLM 时按块顺序拼接，**不含** `opening`（开场已由程序发出）。

### catalog 一行（索引 + 编排结构）

| 字段 | 作用 |
|------|------|
| `id` / `name` / `declaration` / `artifact` | 索引与产物映射；`declaration` 可被 prompt `meta` 覆盖 |
| `repeatable` | 可选；`true` = 允许同能力多次编入增量 DAG |
| `params` | 可选；编排期 `steps[].params` 声明（`key`/`label`/`required`/`hint`）；必填项须在进执行前钉齐 |
| `opening` | 可选覆盖；一般只写在 prompt 的 `opening` 块 |

编排器注入【能力 · 可选工序】时，会读取各能力 `prompt.md` 的 `meta`（`declaration` / `when` / `when_not` / `boundary`），**不是**只看 catalog 短声明。执行全文仍只在 design-step 注入。

### 配方 `recipe.yaml`

| 字段 | 作用 |
|------|------|
| `when` | 适用什么体验 |
| `core` | 整套设计方法的核心思路与目标 |
| `process` | 设计流程（如何增量选型、何时收成） |
| `principles` | 配方特有取舍 |
| `brief` / `steps` | 近期起点；不是固定全程 DAG |

配方**不要**重复罗列各能力调用条件；那是能力 meta 的职责。旧字段 `hint` 仍可读作兜底。

### 节点循环（通用）

```text
开局选配方 → 坐到配方预置的第一个节点
  → 节点 opening → 用户首批输入
  → 节点要求 + 用户输入 → 产物 + 追问
  → 用户选选项 / 写意见 →「按意见修改」
      （产物 + 追问 + 选项 + 意见 + 节点要求一并重跑）→ 新产物
  → 循环直到「接受」
  →「下一步想写什么」（可留空，交给工作流计划 DAG）
  → 展示下一节点并确认开干（可在此钉编排参数，如生成规则的 target）
  → 下一节点 opening / design-step …
直到创作收口
```

「按意见修改」只重跑当前节点，不得跳到「下一步想写什么」。底栏空且未选追问时 Enter＝接受；已选追问时 Enter＝按意见修改。点按钮仍只做按钮自己的事。

有编排参数的能力：可在确认开干时钉齐 params；勿把「生成什么」拖到执行中途才问。

---

## 目录与清单

```text
modules/catalog.yaml
modules/{id}/prompt.md
recipes/world-simulator|expand-assistant/recipe.yaml
```

世界模拟器**可能用到**的能力（编排按需选用，勿默认全选）：

| 能力 | id | 状态 |
|------|-----|------|
| 美学纲领与交互范式 | `aesthetics-interaction` | **范例已写**；前端 mosaic 视图 |
| 实现机制 | `mechanism` | **已写**：`context-fragment.v1`（支撑点正文 + 自评 + 追问）；`feeds: gm`；**专用卡已接** |
| 舞台骨架 | `world-blueprint` | **已写**：`context-fragment.v1`；社会结构 + 世界状况；**专用卡已接** |
| 生成规则 | `generation-rules` | **已写**：`context-fragment.v1`；宽原则 + 严合同键；可反复；`params.target`；挂 gm+auditor；**专用卡已接** |
| 具体实例 | `concrete-instances` | **已写**：`context-fragment.v1`；只按规则执行；可反复；`params.rule_id` |
| 叙事指南与故事推进 | `narrative` | **已写**：一份全文双挂；**不**为省 token 拆投影；结构化卡 |
| 拓扑图谱 | `topology` | 骨架，待细写（拟改为选项小循环或降级） |
| 设计监控栏 | `status-bar` | **已写**：只盯会变信息；通用 fragment 卡 |
| 正文组成 | `reply-format` | **已写**：壳适配；P2 present 渲染已接 |
| 变量设计与更新规则 | `variable-design` | **已写**；专用/结构化卡 |
| 变量控制上下文 | `variable-context` | **已写**：旁观汇总；mount 含 auditor；通用 fragment 卡 |
| 开场白与开场变量 | `opening-setup` | **已写**：开场守版式+同真相初值 |

共用收成（池内保留，按需）：

| 能力 | id | 状态 |
|------|-----|------|
| 游玩拓扑 | `worker-spec` | **已写**：勾选固定槽（含旁观维护 auditor）；禁自由发明 worker |
| 上下文投影排序 | `context-order` | **已写**：扁平投影序（含对话.历史；旁观维护默认无历史）；收成进 `context_order`；Runtime 已拼装 |
| 细化终稿 | `refine` | **已写**：按 `play_slots`（及排序表）收成 `设计.worker集` |

| 编排器 | 状态 |
|------|------|
| 世界模拟器 | 创作链路已写；**play**：`auditor → perspective? → gm → narrator`；settlement/maintain 合并变量已接 |
| 扩写助手 | 方法论已写；起点：美学纲领与交互范式；勿默认套世界模拟全套 |

---

## 验收

1. 只选配方 → 出**近期**创作流程（`status=open`）  
2. design-step 能切割出 `opening`/`task`/…  
3. 有 `opening` 时先程序开场再 LLM  
4. 可追加同能力多次（不同 step.id + params）；收成前 `status=closed`  
5. UI 用编排术语；有编排参数的步骤须展示 params  
6. 缺必填 params 的步骤不得视为可执行（校验失败 / 编排先 askUser）  
