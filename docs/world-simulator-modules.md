# 默认技能包 · 编排器与能力撰写清单

> 包内部 id 仍为 `world-simulator`。用户可见：进料方式「工序编排 / 对话落盘」，配方「回合推演 / 快穿短局 …」——见 **`docs/ui-glossary.md` §0 / §0.1**。  
> 运行：选进料方式与配方 →（工序编排）编排**增量**工作流计划 DAG → `design-step` 执行技能；可再扩步反复调用。  
> **标准范例**：`modules/aesthetics-interaction/prompt.md`。  
> **真值 / Data / Progressive（变量与门控）**：**`docs/progressive-data-design.md`**。  
> **上下文片段 / 槽位 / 投影排序**：**`docs/context-fragment-design.md`**。  
> **游玩呈现壳**：**`docs/play-presentation-shells.md`**（预览页 `/shells.html`）。  
> **主世界层↔旁观怎么配合**：**`docs/play-dm-auditor.md`**。  
> **提示词待改清单**：**`docs/briefs/prompt-revision-inventory.md`**。  
> **design-flow 提示词人工审查**：**`docs/briefs/design-flow-prompt-review.md`**。  
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
| `opening` | 可选 | **默认问题**正文。点进节点时由程序发给用户（不经本步 LLM），用户先答一轮再产出。整块可省略 = 本步直接 LLM |
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
declaration: …   # 规划第一眼：解决什么缺口
when: …          # 对照现场能判定才排
when_not: …      # 每条指向另一技能或「不排」
boundary: …
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
| `repeatable` | 可选；`true` = 允许同能力多次**新建**编入增量 DAG（每次彻底新的，不改旧条） |
| `closer` | 可选；`true` = 创作终节点（选定后落库、关 DAG、保存定稿） |
| `auto` | 可选；`true` = 程序步（提案后直接执行） |
| `kind` | 可选；节点特性。缺省=普通执行步。`prior-artifact` = **先验产物**（须先定写什么；params 是规划产物，执行注入【规划产物】，不拦确认开干） |
| `intake` | 可选；`recipe` = 仅工序编排；`dictate` = 仅对话落盘。缺省=两族都可见 |
| `params` | 可选；普通节点=编排期 `steps[].params` 声明（必填项须在进执行前钉齐）。〔先验产物〕=规划产物字段（可提前填，空则步内钉） |
| `opening` | 可选覆盖；一般只写在 prompt 的 `opening` 块 |

编排器注入【能力 · 可选工序】时，会读取各能力 `prompt.md` 的 `meta`（`declaration` / `when` / `when_not` / `boundary`），**不是**只看 catalog 短声明。执行全文（`task` / `opening` / `output` 等）仍只在 design-step 注入。

**写给规划，不是写给执行：**

| 字段 | 规划用来做什么 | 怎么写 |
|------|----------------|--------|
| `declaration` | 扫描池时的第一眼 | 解决什么缺口；不要写产物 JSON 长什么样 |
| `when` | **现在**要不要进近期 DAG | 对照用户话、已验收步骤、已有产物就能判定的信号（还不能回答哪句 / 已有哪份产物） |
| `when_not` | 缺口其实该交给谁，或明确跳过 | 每条指向另一个技能或「不排」；不要只写禁止 |
| `boundary` | 别和邻居排重 | 本步定什么 / 不定什么 / 交给谁 |

`when` 里不要搬 `task` 的执行细则。配方 `process` 只写方法顺序（如收成链、默认槽），**不要再抄各技能调用条件**。

### 配方 `recipe.yaml`

| 字段 | 作用 |
|------|------|
| `when` | 适用什么体验 |
| `core` | 整套设计方法的核心思路与目标 |
| `process` | 设计流程（如何增量选型、何时收成） |
| `principles` | 配方特有取舍 |
| `brief` / `steps` | 近期起点；不是固定全程 DAG |

配方**不要**重复罗列各能力调用条件；那是能力 meta 的职责。旧字段 `hint` 仍可读作兜底。

### 节点特性（`kind`）

节点特性是 catalog 上的固定系统，不是某一步的特例。缺省为普通执行步；后续会加更多 kind。

| kind | 中文 | 行为 |
|------|------|------|
| （缺省） | 普通执行步 | 有必填 params 时，确认开干前钉齐 |
| `prior-artifact` | 先验产物 | 须先定「写什么」（生成规则、具体实例）。编排器可提前把规划写入 `params`——规划多条是正确的。执行时注入【规划产物】；规划可空，步内钉/修订。不拦确认开干 |

### 节点循环（通用）

```text
开局选配方 → 坐到配方预置的第一个节点
  → 节点 opening → 用户首批输入
  → 节点要求 + 用户输入 → 产物 + 追问
  → 用户选选项 / 写意见 →「按意见修改」
      （产物 + 追问 + 选项 + 意见 + 节点要求一并重跑）→ 新产物
  → 循环直到「接受」
  → 直接提案下一节点并确认开干（普通节点可在此钉编排参数；〔先验产物〕不在此钉「写什么」；〔程序步〕如投影排序跳过确认直接执行）
      · 可反复技能再来一次 = 彻底新建（新 id / 新 params）
      · 已完成节点要改 = 用户在图上点该节点（查看产物 / 重新进入修改），不在 DAG 里加修订步
  → 下一节点 opening / design-step …
直到「开场白与开场变量」（〔收口〕）
  → 产出 1～多条开场白 → 选定 → 程序落库、关闭 DAG、保存创作定稿
```

「按意见修改」只重跑当前节点，不得跳到「下一步想写什么」。底栏空且未选追问时 Enter＝接受；已选追问时 Enter＝按意见修改。点按钮仍只做按钮自己的事。

「回头修改」是已完成节点上的动作，不是 DAG 节点：用户点该格，菜单里回看产物或重进继承旧稿。它**不是**〔可反复〕再来一次——后者从零新建。漏了前面的节点、或谈完才发现要改上游，点那个已完成节点即可，不必整局重开。

〔先验产物〕节点（生成规则、具体实例）：编排器可提前规划「写什么」写入 params——提前规划多条是正确的。确认开干不补「生成什么」；执行时注入【规划产物】，步内钉或修订。

有编排参数的**普通**能力：可在确认开干时钉齐 params。

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
| 主角设定 | `protagonist` | **已写**：有产物则挂在当前选用的用户角色卡下（不进全局列表）；关掉这局就不加载 |
| 实现机制 | `mechanism` | **已写**：`context-fragment.v1`（支撑点正文 + 自评 + 追问）；`feeds: gm`；**专用卡已接** |
| 舞台骨架 | `world-blueprint` | **已写**：`context-fragment.v1`；社会结构 + 世界状况；**专用卡已接** |
| 生成规则 | `generation-rules` | **已写**：`context-fragment.v1`；方向池优先、元素池仅封闭集合；可反复；**〔先验产物〕**；规划字段 `target`；挂 gm+auditor；**专用卡已接** |
| 具体实例 | `concrete-instances` | **已写**：`context-fragment.v1`；只按规则执行；可反复；**〔先验产物〕**；规划字段 `rule_id` |
| 叙事指南与故事推进 | `narrative` | **工序编排**：一份全文双挂；结构化卡。对话落盘不排本步 |
| 叙事指南 | `narrative-guide` | **对话落盘**：遣词/笔墨/禁忌/写法档；`intake: dictate` |
| 故事推进 | `story-progression` | **对话落盘**：推进方式 + 用户输入用法；`intake: dictate` |
| 拓扑图谱 | `topology` | 必须生成且不适合走生成规则→实例时，用拓扑结构写出（升级路径、地图、人物关系等） |
| 回复呈现 | `status-bar` | **已写**：每轮终稿看什么（正文/字数/日期/变量）；旧称设计监控栏 |
| 随机范围整理 | `random-range` | **已写**：汇总检定/对抗等随机项与范围；正文组成之前；替代机遇裁定槽 |
| 正文组成 | `reply-format` | **已写**：把回复呈现清单展示出来；选壳+美化，可写 CSS/HTML/JS；可接隐藏备用随机区 |
| 变量设计与更新规则 | `variable-design` | **已写**；专用/结构化卡 |
| 变量控制上下文 | `variable-context` | **已写**：旁观汇总；mount 含 auditor；通用 fragment 卡 |
| 开场白与开场变量 | `opening-setup` | **已写**：每条 = meta（初值/用户角色）+ present.v1 正文（壳跟正文组成）；**〔收口〕**选定后落库并保存定稿 |

共用收成（池内保留，按需）：

| 能力 | id | 状态 |
|------|-----|------|
| 游玩拓扑 | `worker-spec` | **已写**：不能吃默认槽才勾选；主世界必要；有变量开旁观；禁机遇槽与自由发明 worker |
| 上下文投影排序 | `context-order` | **已写**：扁平投影序（含对话.历史；旁观维护默认无历史）；收成进 `context_order`；Runtime 已拼装 |
| 细化终稿 | `refine` | **已写**：按 `play_slots`（及排序表）收成 `设计.worker集` |

| 编排器 | 状态 |
|------|------|
| 世界模拟器 | 创作链路已写；**play**：`gm → perspective? → narrator → auditor`；真随机改走随机范围表+程序插数（机遇槽弃用）；settlement/maintain 合并变量已接 |
| 扩写助手 | 方法论已写；起点：美学纲领与交互范式；勿默认套世界模拟全套 |

---

## 验收

1. 只选配方 → 出**近期**创作流程（`status=open`）  
2. design-step 能切割出 `opening`/`task`/…  
3. 有 `opening` 时先程序开场再 LLM  
4. 可追加同能力多次（不同 step.id + params，**彻底新建**）；已完成节点由用户在图上点选重进（继承旧产物）；收成前 `status=closed`  
5. UI 用编排术语；有编排参数的步骤须展示 params；已完成节点菜单区分「查看产物」与「重新进入修改」  
6. 缺必填 params 的**普通**步骤不得视为可执行（校验失败 / 编排先 askUser）；〔先验产物〕规划可空，不拦确认开干；重进已完成节点可继承原步 params  
