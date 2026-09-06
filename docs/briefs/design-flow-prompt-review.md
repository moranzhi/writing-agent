# design-flow 提示词人工审查

规划 LLM（`design-flow`）一次请求里会拼上：**本 worker 的 SKILL 正文** + **程序注入的固定句** + **已选配方** + **全部技能 meta**。  
本文把这些静态提示词收齐，供你逐段审查。改源文件后请同步改本文，或重新生成。

用法：每条把 `☐ 未审查` 改成 `☑ 已审查`（可在后面加日期/一句批注）。  
不含：`design-step` 执行全文、`opening`/`task`/`output`、游玩模板、编排器 `orchestrator.md`（那是另一颗 LLM）。

权威路径以各节「源文件」为准。`feeds` 写在 meta 里，但 **不会** 注入 design-flow。

---

## 总表

| # | 条目 | 源文件 | 人工审查 |
|---|------|--------|----------|
| 1 | design-flow SKILL 正文 | `skills/dialogue/world-simulator/workers/design-flow/SKILL.md` | ☑ 已审查 2026-09-06：用户会在意美学卡哪几处 → 节点与 suggestion；同一题材换核换图 |
| 2 | 上下文块标题（contextSegments.label） | `skills/dialogue/world-simulator/workers/design-flow/SKILL.md` frontmatter | ☑ 已审查 2026-09-06：【开头节点】按用户会在意的部分选节点；已验收=id 清单 |
| 3 | 【流程进度】固定句 | `src/skills/creation-flow.ts` → `formatFlowProgressForAgent` | ☑ 已审查 2026-09-06：改成清单怎么用；禁止句改成要干嘛；与 SKILL 对齐 |
| 4 | 【用户已选配方】外壳 | `src/skills/creation-flow.ts` → `formatSelectedRecipeForAgent` | ☑ 已审查 2026-09-06：去掉只排近期；对照美学卡承诺增删；换配方改成要干嘛 |
| 5 | 未选配方时的三句 | （已删）`src/skills/creation-flow.ts` → `formatDesignFlowContentBlocks` | ☑ 已删除 2026-09-06：开局必选配方，不再注入问选用兜底 |
| 6 | 【能力 · 可选工序】外壳 | `src/skills/creation-flow.ts` → `formatModuleCatalogForAgent` | ☑ 已审查 2026-09-06：只收集各节点 meta；调用条件不在外壳 |
| 7 | 配方目录短声明 | `skills/dialogue/world-simulator/recipes/catalog.yaml` | ⏭ 跳过：人工手选列表，不进规划提示词 |
| 8 | 配方 · 世界模拟器 | `skills/dialogue/world-simulator/recipes/world-simulator/recipe.yaml` | ☑ 已审查 2026-09-06：怎么排跟 SKILL；去掉 1～4；禁止句改成要干嘛 |
| 9 | 配方 · 扩写助手 | `skills/dialogue/world-simulator/recipes/expand-assistant/recipe.yaml` | ⏭ 跳过 |
| 10 | 技能 meta · 美学纲领与交互范式 | `skills/dialogue/world-simulator/modules/aesthetics-interaction/prompt.md`（meta） | ☑ 已审查 2026-09-06：声明改成体验承诺；when 去掉近期/可玩套话 |
| 11 | 技能 meta · 实现机制 | `skills/dialogue/world-simulator/modules/mechanism/prompt.md`（meta） | ☑ 已审查 2026-09-06：第一初设定；无特殊变造才不排 |
| 12 | 技能 meta · 舞台骨架 | `skills/dialogue/world-simulator/modules/world-blueprint/prompt.md`（meta） | ☑ 已审查 2026-09-06：会换区才备案；代入后几乎不移动（网聊/门卫室）不排 |
| 13 | 技能 meta · 生成规则 | `skills/dialogue/world-simulator/modules/generation-rules/prompt.md`（meta） | ☑ 已审查 2026-09-06：时机 a 精准格式或时机 b 原创会雾且还要生成，满足一条就排 |
| 14 | 技能 meta · 具体实例 | `skills/dialogue/world-simulator/modules/concrete-instances/prompt.md`（meta） | ☑ 已审查 2026-09-06：用户确认基本没问题；已有预生成规则才排，不改合同 |
| 15 | 技能 meta · 叙事指南与故事推进 | `skills/dialogue/world-simulator/modules/narrative/prompt.md`（meta） | ☑ 已审查 2026-09-06：用户确认基本可以 |
| 16 | 技能 meta · 拓扑图谱 | `skills/dialogue/world-simulator/modules/topology/prompt.md`（meta） | ☑ 已审查 2026-09-06：必须生成且不适合走生成规则→实例；用拓扑结构描述 |
| 17 | 技能 meta · 变量设计与更新规则 | `skills/dialogue/world-simulator/modules/variable-design/prompt.md`（meta） | ☑ 已审查 2026-09-06：用户确认完成 |
| 18 | 技能 meta · 变量控制上下文 | `skills/dialogue/world-simulator/modules/variable-context/prompt.md`（meta） | ☑ 已审查 2026-09-06：用户确认完成 |
| 19 | 技能 meta · 正文组成 | `skills/dialogue/world-simulator/modules/reply-format/prompt.md`（meta） | ☑ 已审查 2026-09-06：展示回复呈现清单；选壳+美化，可写 CSS/HTML/JS |
| 20 | 技能 meta · 回复呈现 | `skills/dialogue/world-simulator/modules/status-bar/prompt.md`（meta） | ☑ 已审查 2026-09-06：必选/可选区域 + 各区简单内容规则（含选项组成） |
| 21 | 技能 meta · 游玩拓扑 | `skills/dialogue/world-simulator/modules/worker-spec/prompt.md`（meta） | ☑ 已审查 2026-09-07：主世界必要；有变量开旁观；取消机遇槽→随机范围整理 |
| 22 | 技能 meta · 上下文投影排序 | `skills/dialogue/world-simulator/modules/context-order/prompt.md`（meta） | ☑ 已审查 2026-09-07：用户确认；已去机遇槽残留 |
| 23 | 技能 meta · 细化终稿 | `skills/dialogue/world-simulator/modules/refine/prompt.md`（meta） | ☐ 未审查 |
| 24 | 技能 meta · 开场白与开场变量 | `skills/dialogue/world-simulator/modules/opening-setup/prompt.md`（meta） | ☐ 未审查 |
| 25 | 技能 meta · 随机范围整理 | `skills/dialogue/world-simulator/modules/random-range/prompt.md`（meta） | ☑ 已写入 2026-09-07：正文组成前汇总随机项与范围；待你过目可再改 |

---

## 一、design-flow worker

### 1. SKILL 全文

人工审查：☑ 已审查 2026-09-06：怎么排=用户会在意美学卡哪几处 → 哪些节点/suggestion 兑现；同一题材换核换图

源：`skills/dialogue/world-simulator/workers/design-flow/SKILL.md`

~~~~
---
id: design-flow
skill: world-simulator
name: 创作 · 流程编排
description: >-
  【编排】从美学卡上用户会在意的部分推出要哪些节点、节点建议写什么；对照已完成 id。
  产出工作流计划 DAG。用户在图上点选执行顺序。本步不写各技能正文。
version: 1
stage: design
inputTags:
  - "用户.需求"
  - "book.brief"
  - "用户.最新输入"
  - "用户.worker答复"
  - "用户.修订说明"
  - "设计.美学纲领与交互范式"
  - "设计.创作流程"
  - "创作.选用配方"
  - "创作.已验收单位"
outputTags:
  - "设计.创作流程"
inputMerge: latest
contextSegments:
  - id: opening-aesthetics
    tier: static
    tags: ["设计.美学纲领与交互范式"]
    label: "## 【开头节点 · 美学纲领】用户会在意这张卡的哪几处？用那些承诺选节点（无则先排本步）"
  - id: accepted-units
    tier: static
    tags: ["创作.已验收单位"]
    label: "## 【已验收步骤】已完成节点的 id 清单（只作覆盖标记，不是各步正文）"
  - id: prior-flow
    tier: static
    tags: ["设计.创作流程"]
    label: "## 【已有工作流计划】在其上修订；无则新建"
  - id: selected-recipe
    tier: static
    tags: ["创作.选用配方"]
    label: "## 【用户已选配方】只读引用"
  - id: user-demand
    tier: dynamic
    tags: ["用户.需求", "book.brief", "用户.worker答复"]
    label: "## 用户表述"
---



# 创作 · 流程编排

读【开头节点 · 美学纲领】里**用户会在意的部分**，推出要哪些节点、节点建议写什么；对照【已验收步骤】标记，从【能力 · 可选工序】排出一份 **工作流计划 DAG**，写入 tag `设计.创作流程`。无美学卡时用【用户要求】当种子。

产出：节点 + `depends_on` +（〔可反复〕）原型槽位与 `suggestion` + 可选顶层 `suggestions`。用户在图上点选下一步；你给出依赖与建议阅读序。

先读【流程进度】（已完成 / 草案已有 / 尚未编入）、【用户已选配方】、【能力 · 可选工序】，再排。要求按先后都有效，冲突时以较新的为准。

## 怎么排

先当用户看这张美学卡：**我会在意哪几处？** 那几处是本局要兑现的承诺。再问：兑现每一处，要哪些技能节点、节点里建议写什么？已完成 id 表示那一处已经有槽。

同一题材，卡上在意的东西不同，图和 suggestion 就不同。例如都是丧尸末日：

- 核是异能觉醒、升级、对抗（网文）→ 生成规则写异能/等级合同，变量盯等级与觉醒，叙事管打脸与对抗节奏
- 核是人与人背刺（美式）→ 具体实例锚定开局几个人，叙事管背叛与信任，变量控制管信任度和资源缺口；舞台可以很薄
- 核是砍砍砍（B 级片）→ 生成规则写可砍的尸群，叙事管血腥动作笔墨；等级、背刺、复杂社会可以不排，反倒是武器生成规则需要仔细斟酌

题材名（丧尸、都市、宫廷）本身不决定套件。用户会反复感到的那几处才决定。

无美学卡：体验尚未钉清，先排「美学纲领与交互范式」；其余只排此刻能从【用户要求】看出用户在意什么。美学已验收之后，按这些承诺把该排的节点写进 `steps`——需要几步排几步。

选定节点时对照【能力 · 可选工序】的何时用 / 何时不用 / 边界：这份承诺该由哪个技能兑现。配方 `core` / `process` / `principles` 给方法顺序（默认槽、收成链），不代替「用户在意什么」。含糊或可跳过则不排。已在草案里的 `name` 保留，一次性技能不写第二份。能力池里兑不了那处承诺：不发明新 `name`，askUser 问用户改体验还是放弃那一处。

用户要补节点：插在未验收步之前、收口之前，`status: "open"`。新 `name` 只从【流程进度】「尚未编入、仍可调用」里选。

〔可反复〕的 `suggestion` 必须点名这局在意的对象（异能合同 / 开局背刺对象 / 可砍尸群），不要写成空泛的「NPC 与物资」。本局还可能用到、但暂时不写进 `steps` 的：写入顶层 `suggestions`。已在 `steps` 里的不重复。暂时不必则省略。

## 节点怎么写


| 类型   | JSON                                      | 进入执行                               |
| ---- | ----------------------------------------- | ---------------------------------- |
| 普通一步 | 无 role                                    | 用户点上 → design-step                 |
| 原型槽位 | `"role": "prototype"` + `suggestion`      | 用户点上 → 程序增殖 instance → design-step |
| 实例   | `"role": "instance"`, `"from": "<原型 id>"` | 仅程序增殖                              |


〔可反复〕（生成规则、具体实例等）：`steps` 里写一条原型即可（id 通常与 name 相同，如 `"生成规则"`），并写 `suggestion`（建议这条原型将来生成什么）。原型只带 `suggestion`；「写什么」在用户点原型后的实例步内钉。

已完成节点要改：用户在图上点该节点重进。编排只追加未验收步、改未验收依赖；已验收 id 原样留在 `steps`。

〔收口〕「开场白与开场变量」排在 `steps` 最后。选定开场前若要补前序节点，插在收口之前，保持收口为最后一步，`status` 仍为 `"open"`。

askUser 只问排布（补哪个原型、改依赖）。用户谈到体验正文：当作编排线索；体验细节留到对应技能步。排布已能写清则直接产出。

## 产出

根对象就是下面这份 JSON（必须含 `steps`）。

```json
{
  "brief": "代入觉醒者，反复感到升级碾压与对抗",
  "status": "open",
  "suggestions": [
    {
      "name": "具体实例",
      "suggestion": "开局 1 个对照用的未觉醒同伴",
      "depends_on": ["生成规则"]
    }
  ],
  "steps": [
    { "id": "美学纲领与交互范式", "name": "美学纲领与交互范式", "depends_on": [] },
    {
      "id": "生成规则",
      "name": "生成规则",
      "role": "prototype",
      "suggestion": "异能觉醒与升级合同",
      "depends_on": ["美学纲领与交互范式"]
    },
    {
      "id": "变量设计与更新规则",
      "name": "变量设计与更新规则",
      "depends_on": ["美学纲领与交互范式"]
    },
    {
      "id": "叙事指南与故事推进",
      "name": "叙事指南与故事推进",
      "depends_on": ["美学纲领与交互范式"]
    },
    {
      "id": "细化终稿",
      "name": "细化终稿",
      "depends_on": ["生成规则", "变量设计与更新规则", "叙事指南与故事推进"]
    },
    {
      "id": "开场白与开场变量",
      "name": "开场白与开场变量",
      "depends_on": ["细化终稿"]
    }
  ]
}
```

1. `steps` 顺序 = 建议阅读顺序；`depends_on` 指向更前步骤 id
2. `name` = 能力池固定中文名
3. `id` 本局唯一；原型 id 稳定（如 `生成规则`）；实例 id 由程序增殖（`生成规则#1`…）
4. 具体实例原型依赖生成规则原型（至少一条规则实例验收后才可增殖）
5. `summary`：`流程 · N 步 · open|closed · …`



## 自检

- 节点和 `suggestion` 是否兑现卡上用户会在意的那几处（同一题材换核会换图），而不是题材默认套件？
- 已验收 id 是否都在 `steps` 里？
- 〔可反复〕是否都是 `role=prototype` + suggestion？
- 尚未编入里本局还可能用到的〔可反复〕是否进了 `suggestions`？
- 收口是否在最后？`depends_on` 是否合法？
~~~~

### 2. 上下文块标题

人工审查：☑ 已审查 2026-09-06：【开头节点】按用户会在意的部分选节点；已验收=id 清单；工作流计划

拼进 prompt 的 Markdown 标题（frontmatter `contextSegments.label`）。后面跟黑板 tag 正文，不在此审查。

~~~~
## 【开头节点 · 美学纲领】用户会在意这张卡的哪几处？用那些承诺选节点（无则先排本步）
## 【已验收步骤】已完成节点的 id 清单（只作覆盖标记，不是各步正文）
## 【已有工作流计划】在其上修订；无则新建
## 【用户已选配方】只读引用
## 用户表述
~~~~

---

## 二、程序注入（固定句）

源：`src/skills/creation-flow.ts`。带 `{…}` 的是按现场填的，审查时看固定句。

### 3. 【流程进度】

人工审查：☑ 已审查 2026-09-06：清单怎么用；禁止句改成要干嘛；与 SKILL 对齐

~~~~
【流程进度】程序按现场列出：已完成、草案已有、原型槽位、尚未编入。编排以这份清单为准。
已完成 = 覆盖标记（原 id 留在 steps）；草案已有 = 保留原 id，在其上追加或改未验收依赖；尚未编入 = 新 name 只从这里选。
〔可反复〕在 steps 里写一条 role=prototype，带 suggestion（点名这局在意的对象）。「写什么」在用户点原型后的实例步里钉。
一次性技能已覆盖的那一面：要改则用户点该节点重进。要改已有实例：用户点该实例重进。点原型增殖 = 全新 instance（role=instance，from=原型 id）。

（以下段落按现场拼装，审查固定句即可）
草案已有〔收口〕「…」但尚未选定。用户要补节点时：把新步插在收口之前，保持收口为最后一步，并将 status 改回 open。收口已排入仍可在它前面加步。

已完成：尚无已验收步骤。草案里的开局步是配方预置起点，保留原 id。
已完成：
- {name}（id: …） · 已验收|产物已在黑板 〔可反复：… / 一次性：这一面已覆盖；要改则用户点该节点重进〕

草案已有、尚未验收（保留原 id）：
- {name}（id: …） · 已在草案，保留原 id

原型槽位（保留；用户点增殖）：
- {name}（id: …，role=prototype） · 建议：… · 保留；用户点此槽增殖 instance

建议追加的原型（可编入 steps 为 role=prototype）：
- {name} · {suggestion} · 依赖 …

尚未编入、仍可调用（新 name 只从这里选）：
- {name}〔可反复〕〔收口〕：{declaration}
尚未编入、仍可调用：无。用户只能点图上已有节点，或对〔可反复〕原型增殖。

目录〔可反复〕：生成规则、具体实例（排骨架时用 role=prototype）
目录〔可反复〕：以能力目录为准。
~~~~

### 4. 【用户已选配方】外壳

人工审查：☑ 已审查 2026-09-06：去掉只排近期；对照美学卡承诺增删；换配方改成要干嘛

配方 `when` / `core` / `process` / `principles` / `steps` 插在此后，见第 8、9 条。

~~~~
【用户已选配方 · {name}】
这是用户手动选定的设计方法。步骤名从【能力】选。
对照美学卡上用户会在意的部分与配方方法论，增删改未验收步骤与依赖；已验收步保留。
能力「何时用 / 何时不用」以【能力 · 可选工序】为准；本配方不重复罗列各能力调用条件。
用户要换配方：等用户在界面重新选定后再编排。
简介：…
适用：…
核心思路：
…
设计流程：
- …
原则：
- …
开局 steps（配方预置起点，可按美学卡上的承诺增删）：
```json
{ brief, status, steps }
```
~~~~

### 5. 未选配方

人工审查：☑ 已删除 2026-09-06：开局必选配方，这段不再注入。

（原三句「用户尚未手动选择 / 禁止自行猜测 / 请 askUser 选配方」已从 `formatDesignFlowContentBlocks` 去掉。无已选配方时只不注入第 4 条外壳，不再让规划 LLM 问选用。）

### 6. 【能力 · 可选工序】外壳

人工审查：☑ 已审查 2026-09-06：只收集各节点 meta；调用条件不在外壳。固定句暂留（标记怎么读）。

~~~~
【能力 · 可选工序】
按需选用，勿默认全选；步骤名只能从这里选；标〔可反复〕的可多次编入；标〔收口〕的是终节点：排在细化终稿之后作最后一步；尚未选定开场前，用户要补前序节点（如 NPC）时插在收口之前，勿以「收口已排入」拒绝追加；选定后才结束创作并保存；标〔程序步〕的确认编排后直接执行（不抛默认问题、不经同意并开始），产物仍验收。
标〔先验产物〕（生成规则、具体实例）：编排层只排 role=prototype 槽位 + suggestion；禁止在原型写 params、禁止预排 instance。「写什么」在用户点原型增殖后的实例步内钉。
其它有「编排参数」的步骤：确认开干前写齐必填 params；缺参时用 askUser 选项+其它。
选型依据是下方「何时用 / 何时不用 / 边界」（来自各能力 meta）。对照用户表述与已验收产物判定：该排才排；可跳过或条件含糊则不排。不要用执行细则补脑。
〔可反复〕再编入新 id = 彻底新建一条。已完成节点要改：禁止排 mode=revise 新步；用户会在图上点该节点重进。禁止把改旧稿写成又一条 fresh。
不要把能力执行全文塞进本步；执行由 design-step 注入。

（下方逐条拼接各技能 declaration / when / when_not / boundary / params；全文见第三节）
~~~~

---

## 三、配方

### 7. 配方目录

人工审查：⏭ 跳过：人工手选列表，不进规划提示词

源：`skills/dialogue/world-simulator/recipes/catalog.yaml`  
（用户选型列表；选定后才注入第 4 条外壳 + 对应 recipe.yaml。）

~~~~
# 导演选项目录（用户在新建作品时手动选择；对用户称「导演」/「配方」）
# id = recipes/{id}/ 文件夹
# name = 固定中文名（下拉展示）
# declaration = 给人看的短说明
# 内部仍叫 recipe；勿对用户再说「配方」作第二层选项
# recipe.yaml 写方法论：when / core / process / principles + 近期 steps
# 步骤 name 必须 ∈ modules/catalog.yaml（【能力】）
# 选定后写入黑板 tag 创作.选用配方

recipes:
  - id: world-simulator
    name: 世界模拟器
    declaration: 回合互动、世界推进、角色扮演类体验的设计方法

  - id: expand-assistant
    name: 扩写助手
    declaration: 大纲/分段写作、写手统筹、成稿向助手类体验的设计方法
~~~~

### 8. 世界模拟器

人工审查：☑ 已审查 2026-09-06：怎么排跟 SKILL；去掉 1～4；禁止句改成要干嘛

源：`skills/dialogue/world-simulator/recipes/world-simulator/recipe.yaml`

~~~~
# 世界模拟器 · 配方
# 写方法论：适用、核心思路、设计流程、原则。
# 各技能何时用 / 不用 → 读技能 meta（编排器会注入），勿在此重复。
# steps = 开局起点；选中本配方时程序写入「设计.创作流程」，开局即坐在第一步。

when: 回合互动、世界推进、角色扮演、沉浸推演类体验

core: >-
  先钉清用户如何参与、正文如何呈现、核心体验与禁忌（美学卡上用户会在意的部分）；
  再按那些承诺选出要兑现的上下文技能，并标明挂哪些固定槽（默认：主世界层裁决 + 叙事转述）；
  挂载归属可早定，插入顺序必须晚定——收成前用「上下文投影排序」按各块概括排出数字序与双锚点投影；
  再细化终稿收成运行规格。执行单元只用固定槽（主世界层 / 叙事转述 / 可选角色视角 / 可选机遇裁定），不为表/百科再拆槽。

process:
  - 开始通常先做「美学纲领与交互范式」。
  - 读美学卡上用户会在意的部分，对照【能力 · 可选工序】的何时用 / 何时不用，把兑现那些承诺所需的节点写进 steps（需要几步排几步）。各技能调用条件以 meta 为准，本表不重复。
  - 世界模拟默认槽：旁观维护 + 主世界层 + 叙事转述（视角关、机遇关）。能吃默认则不必排「游玩拓扑」。
  - 中段按承诺写上下文；每块只标挂谁（mount）与稳/变，order 留给「上下文投影排序」。挂载归属：世界/机制/生成 → 主世界层；叙事指南 → 叙事转述（推进兼挂主世界层）；美学进常驻。
  - 「回复呈现」几乎都排：先钉每轮看什么；「正文组成」在其后把清单展示出来（选壳、美化，可写 CSS/HTML/JS），开场白之前。
  - 收成链顺序固定：上游上下文大致齐 →「回复呈现」→「正文组成」→「上下文投影排序」→「细化终稿」→ 需要开场则「开场白与开场变量」（〔收口〕）。选定开场后结束创作并保存。

principles:
  - 正推：美学卡上用户会在意的部分 → 缺口 → 技能。同一题材换核就换图，不按题材套世界模拟全套。
  - 技能选型以技能 meta 为准；本配方不代替各技能写调用条件。
  - 执行单元只用固定槽（主世界层 / 叙事转述 / 可选角色视角 / 可选机遇裁定）。
  - 默认少槽：主世界层 + 叙事转述；仅强信息隔离才开角色视角；骰子/抽签/比点开机遇裁定（按需程序工具，不进每轮）。
  - 挂谁可早、排第几须晚：插入序与投影位只由「上下文投影排序」产出；中段技能写 mount 与稳/变。
  - 投影序扁平：「对话.历史」按 projection 动态裁剪；少变靠前、易变靠后是软规则，不是硬分区。
  - 真值 / Data / Progressive 三分；派生性格与章细纲不落可写真值。
  - 有编排参数的步骤：进执行前钉齐 params（askUser 选项+其它）；缺参时先问再进 design-step。
  - 〔可反复〕可再追加（彻底新建）；已验收 id 留在 steps。
  - 舞台骨架通常都排（备案，只分详细度）；代入后几乎不移动、只在一处待着则不排。实现机制对照其 meta。
  - 百科与查表归主世界层；裁决归主世界层、可见正文归叙事转述。

brief: 世界模拟类：美学卡上在意的部分→挂槽写上下文→晚排序投影→收成运行规格

steps:
  - id: 美学纲领与交互范式
    name: 美学纲领与交互范式
    depends_on: []
~~~~

### 9. 扩写助手

人工审查：⏭ 跳过（本轮先不改）

源：`skills/dialogue/world-simulator/recipes/expand-assistant/recipe.yaml`

~~~~
# 扩写助手 · 配方
# 写方法论：适用、核心思路、设计流程、原则。
# 各能力何时用 / 不用 → 读能力 meta（编排器会注入），勿在此重复。
# steps = 近期起点；选中本配方时程序写入「设计.创作流程」，开局即坐在第一步（不是固定全程 DAG）。

when: 大纲/分段扩写、写手统筹、先纲后章、成稿向助手、长文/爽文类体验

core: >-
  先钉清写手/统筹站位、分段轮转、爽点与禁忌；
  再落到「谁写大纲、谁写正文」的可执行规格；
  世界舞台与状态机仅在体验真需要时才引入，默认不做世界模拟全套。

process:
  - 开始通常先做「美学纲领与交互范式」。
  - 对照【能力 · 可选工序】的「何时用 / 何时不用」选型；调用条件以技能 meta 为准。
  - 收成前若不能吃写手默认槽（大纲+章节），再排「游玩拓扑」勾选 →「细化终稿」并 closed。
  - 舞台、机制、变量、监控栏等：仅当对应技能「何时用」成立时再选，勿套世界模拟全套。

principles:
  - 正推写手体验，勿默认套「世界模拟」全套能力。
  - 能力选型以能力 meta 为准；本配方不代替各能力写调用条件。
  - 禁止自由发明执行单元；写手路径只用 outline + chapter-writer 固定槽。
  - 有编排参数的步骤须在进执行前钉齐 params；禁止空壳进 design-step。
  - 同能力可反复编入；已验收步骤不得删除。
  - 收成前 status: closed，产物进运行规格而非散文说明书。

brief: 扩写/写手类：先定站位与轮转，再落到大纲→分段写文规格

steps:
  - id: 美学纲领与交互范式
    name: 美学纲领与交互范式
    depends_on: []
~~~~

---

## 四、技能 meta（注入【能力 · 可选工序】）

规划只看见 `declaration` / `when` / `when_not` / `boundary` 和 catalog 标记（〔可反复〕〔收口〕〔程序步〕〔先验产物〕）及 params。  
`feeds` 与执行块不进 design-flow。

### 10. 美学纲领与交互范式（`aesthetics-interaction`）

人工审查：☑ 已审查 2026-09-06：声明改成体验承诺；when 去掉近期/可玩套话

源：`skills/dialogue/world-simulator/modules/aesthetics-interaction/prompt.md`

~~~~
name: 美学纲领与交互范式
id: aesthetics-interaction
artifact: 设计.美学纲领与交互范式
declaration: >
  钉清用户会在意的体验承诺：站位、反复感到什么、轮转何时停。询问相近故合为一步。
when: |
  还不能回答这三件：代入还是旁观？最想反复感到什么？轮转到哪必须停等用户？
  无上游，通常作第一步。
when_not: |
  这三件已有等价定稿、用户未要求重谈 → 不重复排入。
  只改文风 → 「叙事指南与故事推进」；只改版式/监控 → 「正文组成」/「设计监控栏」。
  只改舞台、规则、真值、槽位 → 对应下游技能。与「给玩家什么体验」无关 → 不排。
boundary: |
  本技能：体验是什么、怎么发生在用户身上、轮转怎么停。产出供后续编排阅读的开头节点。
  叙事指南与故事推进：把感觉落成遣词/笔墨/禁忌与推进——本步只钉感觉与轮转。
  舞台骨架 / 具体实例 / 生成规则：舞台与可执行规则——本步不定。
  实现机制 / 变量* / 监控栏 / 正文组成 / 游玩拓扑 / 上下文投影排序 / 细化终稿：落到可运行结构——本步不定。
feeds: design_only
~~~~

### 11. 实现机制（`mechanism`）

人工审查：☑ 已审查 2026-09-06：第一初设定；无特殊变造才不排

源：`skills/dialogue/world-simulator/modules/mechanism/prompt.md`

~~~~
name: 实现机制
id: mechanism
artifact: 设计.实现机制
declaration: >
  整体感觉已钉，故事里有必须当作既成事实的变造法则（科幻意义上的第一初设定）时：点出它们如何约束故事，不解释为何存在
when: |
  已有「美学纲领与交互范式」或等价整体感觉，且用户表述或美学卡里有必须当作既成事实的变造法则。
  例：现代都市但已繁荣一统、存在修炼体系；三体黑暗森林；机器人三定律。
  特征：故事不必纠结它为什么存在，拿掉则故事骨架会换。
when_not: |
  整体感觉未钉 → 先「美学纲领与交互范式」。
  没有特殊变造，或「特殊」只是身份/开场处境、能被「舞台骨架」「具体实例」「开场白与开场变量」覆盖（如现实世界模拟普通大学生）→ 不排。
boundary: |
  本技能：点名故事当作既成事实的变造法则，写清如何约束后续；不补起源、不写舞台百科、不写人物名片。
  美学纲领与交互范式：体验与轮转——本步不重定。
  舞台骨架：环境与社会格局。具体实例 / 开场白与开场变量：名片与第一屏（身份特殊走它们）。
  生成规则 / 变量* / 叙事指南与故事推进：持续生成、跨轮真值、遣词推进——本步只钉前提法则。
feeds: gm
~~~~

### 12. 舞台骨架（`world-blueprint`）

人工审查：☑ 已审查 2026-09-06：会换区才备案；代入后几乎不移动（网聊/门卫室）不排

源：`skills/dialogue/world-simulator/modules/world-blueprint/prompt.md`

~~~~
name: 舞台骨架
id: world-blueprint
artifact: 设计.舞台骨架
declaration: >
  本局舞台备案：划出玩家实际游玩会换区活动的主要区域并写细；尺度与详细度随体验变。代入后几乎不移动、只在一处待着则不排
when: |
  已有「美学纲领与交互范式」或等价整体感觉，且玩家实际游玩会在划分的活动区域上发生（会换区、会移动）。
  变造世界与现实世界都要排：只是详细度有所不同。
  玩家实际游玩过程中的主要活动区域必须写细，但如果本身世界变造不多、或特殊设定较少（如西幻就足以概括的世界），就不需要多写。
when_not: |
  整体感觉未钉 → 先「美学纲领与交互范式」。
  代入后几乎不移动：玩家只会在一处待着体验，不会走到别的活动区域（如网聊、门卫室）→ 不排。
  可点名名片 → 「具体实例」另排。持续生成合同 → 「生成规则」。
boundary: |
  本技能：舞台备案——范围、基底+变造、主要活动区域（写细）、社会结构、世界状况。
  美学纲领与交互范式：体验与轮转——本步不重定。
  实现机制：既成变造法则——本步把法则落到活动区域上长什么样，不重钉法则来源。
  具体实例 / 生成规则 / 叙事指南与故事推进：名片、生成节奏、遣词与推进——本步不定。
feeds: gm
~~~~

### 13. 生成规则（`generation-rules`）

人工审查：☑ 已审查 2026-09-06：时机 a 精准格式或时机 b 原创会雾且还要生成，满足一条就排

源：`skills/dialogue/world-simulator/modules/generation-rules/prompt.md`

~~~~
name: 生成规则
id: generation-rules
artifact: 设计.生成规则
declaration: >
  要精准格式，或本局原创听了会雾且故事里还要生成时：写出该对象族怎么生成（描写/格式/可选池）；不填最终实例；可按对象反复
when: |
  已有「美学纲领与交互范式」或等价整体感觉，且下面两条满足一条就排（可按对象族反复）：
  a. 生成物必须有精准格式。例：武功典籍要有名字、效果、阶层。
  b. 本局原创、听了会一头雾水的东西，故事里还要随机/反复生成。例：人人能绽放的「心之彩」；当成本局原创的斩魄刀。
when_not: |
  整体感觉未钉 → 先「美学纲领与交互范式」。
  常识能推、也不需要精准格式（现实名车、西幻常见种族）→ 不排。
  只要几张具名名片、不必按规则生成 → 不排；已有规则再要名片 → 「具体实例」。
  跨轮记住什么 → 「变量设计与更新规则」。故事怎么往前写 → 「叙事指南与故事推进」。
boundary: |
  本技能：一条规则＝怎么描写/生成 + 单层 JSON 产物格式 + 可选多池（各绑一个顶层字段）。
  具体实例：按规则填最终 records；本步不写最终实例（池条目≠实例）。
  舞台骨架 / 实现机制：可引用，不重写百科、不重钉既成法则。
  变量*：游玩期状态更新——本步只约束生成时的类型与合法初值范围。
  旁观维护：可读合同（rule_id、产物格式、何时可 need_generate）；不依赖整份描写长文。
feeds: gm,auditor
~~~~

### 14. 具体实例（`concrete-instances`）

人工审查：☑ 已审查 2026-09-06：用户确认基本没问题；已有预生成规则才排，不改合同

源：`skills/dialogue/world-simulator/modules/concrete-instances/prompt.md`

~~~~
name: 具体实例
id: concrete-instances
artifact: 设计.具体实例
declaration: >
  已有预生成规则时：按该规则原样交出 records；不设计、不改合同；可按规则/批次反复
when: |
  「设计.生成规则」里已有 `seed_only` 或 `seed_and_runtime` 的规则，且现在需要实际名片/记录（开局 NPC、种子事件等）。
when_not: |
  尚无规则或规则不完整 → 先「生成规则」。想改格式/方法/池 → 回「生成规则」，本步不改合同。
  规则是 `runtime_only` → 不排，游玩期再生成。
  只要规则不要预写实例 → 不排。
boundary: |
  本技能只做一件事：按指定规则生成 records。规则说怎么写、什么格式、如何用池，就照做。
  生成规则：合同制定方——本步不重论证、不修改。
feeds: gm
~~~~

### 15. 叙事指南与故事推进（`narrative`）

人工审查：☑ 已审查 2026-09-06：用户确认基本可以

源：`skills/dialogue/world-simulator/modules/narrative/prompt.md`

~~~~
name: 叙事指南与故事推进
id: narrative
artifact: 设计.叙事指南与故事推进
declaration: >
  美学已有方向时：把感觉落成可执行的遣词、笔墨落点、禁忌与推进方式；不重做体验问卷
when: |
  已有美学纲领（或等价），但转述/主世界层仍会不知道这四件：遣词什么味道、笔墨落谁身上、绝对不能写什么、故事靠场面自己推还是等用户。
  用户主动谈文风、措辞禁忌、写法档（官能/爽文/恐怖/情色等）也排。
when_not: |
  美学未钉 → 先「美学纲领与交互范式」。
  用户只要感觉/站位、不要文风细则 → 不排，沿用美学。
  版式/壳/监控栏 → 「正文组成」/「设计监控栏」。
  事件池 schema、真值增减 → 「生成规则」/「变量设计与更新规则」。
boundary: |
  本技能：一份 context-fragment，写清怎么写 + 怎么推；不必拆技能、也不必为省 token 做精细双投影。
  美学：感觉与轮转。生成规则/变量*：合同与表。
feeds: narrator,gm
~~~~

### 16. 拓扑图谱（`topology`）

人工审查：☑ 已审查 2026-09-06：必须生成且不适合走生成规则→实例；用拓扑结构描述

源：`skills/dialogue/world-simulator/modules/topology/prompt.md`

~~~~
name: 拓扑图谱
id: topology
artifact: 设计.拓扑图谱
declaration: >
  有些东西必须生成，但不需要或不适合走「生成规则→具体实例」时：用拓扑结构写出来（升级路径、地图、人物关系等）
when: |
  已有「美学纲领与交互范式」或等价整体感觉，且同时满足：
  这些东西必须生成；不需要或不适合走「生成规则→具体实例」；能用拓扑结构描述。
  很泛：升级路径、地图、人物关系等等都可以。
when_not: |
  整体感觉未钉 → 先「美学纲领与交互范式」。
  需要精准格式，或本局原创听了会雾且还要按规则生成 → 「生成规则」；已有规则再要名片 → 「具体实例」。
  只是活动区域写细、没有拓扑可描述 → 「舞台骨架」。
  跨轮真值 → 「变量设计与更新规则」。执行单元勾选 → 「游玩拓扑」。
  没有必须生成的拓扑结构 → 不排。
boundary: |
  本技能：用拓扑结构写出必须存在、又不走生成规则合同的内容（节点、连接、方向/层级）。
  生成规则 / 具体实例：复杂合同与 records——本步不写生成格式、不填名片表。
  舞台骨架：活动区域写细——本步不重写舞台百科。
  游玩拓扑：固定槽勾选——本步不描述执行单元谁读谁写。
  变量*：跨轮状态——本步不设计变量表。
feeds: gm
~~~~

### 17. 变量设计与更新规则（`variable-design`）

人工审查：☑ 已审查 2026-09-06：用户确认完成

源：`skills/dialogue/world-simulator/modules/variable-design/prompt.md`

~~~~
name: 变量设计与更新规则
id: variable-design
artifact: 设计.变量设计与更新规则
declaration: >
  体验必须跨轮记住少数状态时：钉真值、谁可写、如何变、维护语句，以及按值换文案的映射索引
when: |
  体验需要跨轮记住少数状态，否则会糊：必须可查询、门控、防重复，或到某值换一套态度/文案/章纲。
  用户点名要好感/资源/阶段数字、分档换性格、进度门控时排。
when_not: |
  无状态纯对话，或状态只临场描写、从不程序化 → 不排。
  只要大段设定不要门控 → 「舞台骨架」/「生成规则」。
  只规定谁的提示词看见什么 → 「变量控制上下文」。
  只规定用户看见哪些监控字段 → 「设计监控栏」。
boundary: |
  本技能：真值清单、更新规则、维护语句约定、Data 映射索引、side_effects 草案。
  分档长文/性格切片正文：由生成规则定格式、具体实例填表；本步做索引与门控，不重写整表。
  正文组成：隐藏段定界符——本步钉「维护语句写什么」；定界样式与之对齐。
  机遇裁定 chance：真随机 toolcall，不是变量表维护手段。
  变量控制上下文：挂载对象与旁观汇总视野。
  细化终稿：收成 tables.side_effects。
feeds: gm
~~~~

### 18. 变量控制上下文（`variable-context`）

人工审查：☑ 已审查 2026-09-06：用户确认完成

源：`skills/dialogue/world-simulator/modules/variable-context/prompt.md`

~~~~
name: 变量控制上下文
id: variable-context
artifact: 设计.变量控制上下文
declaration: >
  已有真值或映射时：钉谁看见什么（主世界层/转述/旁观）、未解锁不注入；无信息差则可不排
when: |
  变量设计已有真值或 Data 映射，且存在信息差：玩家不该看见但主世界层/旁观要知道，或到某档才允许提起，或旁观需要「当前档摘要」。
when_not: |
  尚无变量且无投影 → 不排。
  仅内部记账、永不进任何提示词 → 跳过，在变量设计备注即可。
  只改字段与更新规则 → 「变量设计与更新规则」。
  真值对所有槽同样可见、无剧透边界 → 可不排。
boundary: |
  本技能：挂载表、剧透边界、旁观汇总视野、与维护语句/投影 tag 对齐。
  变量设计：字段、映射索引、维护语句形状、side_effects。
  具体实例：表行正文——本步不重生成，只声明「旁观读当前档/哪几个摘要键」。
  设计监控栏 / 正文组成：用户可见层；本步管提示词视野。
feeds: gm,auditor
~~~~

### 19. 正文组成（`reply-format`）

人工审查：☑ 已审查 2026-09-06：展示回复呈现清单；选壳+美化，可写 CSS/HTML/JS

源：`skills/dialogue/world-simulator/modules/reply-format/prompt.md`

~~~~
name: 正文组成
id: reply-format
artifact: 设计.正文组成
declaration: >
  把「回复呈现」已钉的内容展示给用户：选壳、美化排版，可写 CSS/HTML/JS；排在回复呈现之后、开场白之前
when: |
  已有「回复呈现」（或等价：每轮终稿看什么已钉）后排。几乎每局都要。
  必须在「开场白与开场变量」之前。
when_not: |
  还不知道每轮给用户看什么 → 先「回复呈现」。
  不要排在开场白之后。几乎不跳过。
  只谈文风遣词 → 「叙事指南与故事推进」。只改呈现清单（字数/变量/日期）→ 「回复呈现」。
boundary: |
  本技能：前端展示——从【可选呈现壳】选壳、把回复呈现的各项落到区域、美化排版（可含 CSS/HTML/JS）。
  回复呈现：看什么、正文多少字、展示哪些变量——本步不重议清单，只负责怎么显示。
  叙事指南：文风。变量设计：真值规则。开场白：第一屏——本步先定展示。
feeds: narrator
~~~~

### 20. 回复呈现（`status-bar`）

人工审查：☑ 已审查 2026-09-06：必选/可选区域 + 各区简单内容规则（含选项组成）

源：`skills/dialogue/world-simulator/modules/status-bar/prompt.md`

~~~~
name: 回复呈现
id: status-bar
artifact: 设计.监控栏
declaration: >
  几乎每局都要：钉每轮终稿的必选/可选区域，以及各区域的简单内容规则（字数、段落、选项怎么组成等）；不排版
when: |
  舞台/世界/变量等上游大致齐后排。几乎每局都要。
  排在「正文组成」之前：先钉有什么区域、各区怎么写，再交给正文组成去展示。
when_not: |
  上游还没齐 → 先那些。
  只谈怎么排版、选壳、CSS/HTML/JS → 「正文组成」。
  只谈文风遣词 → 「叙事指南与故事推进」。
  变量如何增减 → 「变量设计与更新规则」（本步只定展示哪些、展示规则）。
boundary: >
  本技能：区域清单（必选/可选）+ 各区域简单内容规则（字数、自然段、选项槽位与提示口径等）。
  正文组成：如何把这些区域展示给用户（壳、美化、CSS/HTML/JS）——本步不定版式。
  变量设计：真值与更新——本步可点名要展示的键与监控规则，不写增减公式。
feeds: narrator
~~~~

### 21. 游玩拓扑（`worker-spec`）

人工审查：☑ 已审查 2026-09-07：主世界必要；有变量开旁观；取消机遇槽→随机范围整理

源：`skills/dialogue/world-simulator/modules/worker-spec/prompt.md`

~~~~
name: 游玩拓扑
id: worker-spec
artifact: 设计.worker规格
declaration: >
  不能吃默认槽时才勾选：主世界层必开；有变量/表维护才开旁观；转述默认开；强秘密才开视角；写手则大纲+章节；禁止发明执行单元与机遇槽
when: |
  体验契约已大致清楚，且不能吃默认槽：要关旁观、关转述、开角色视角（强秘密不能进主世界层），或走写手大纲+章节。
  或要修订已勾选槽（开/关 auditor、perspective、narrator 等）。
when_not: |
  体验/站位仍混沌 → 先「美学纲领与交互范式」。
  世界模拟可吃默认（主世界层+转述+旁观；视角关）→ 可不排，「细化终稿」按默认收成。
  只需输出完整运行规格 → 「细化终稿」（本步只交槽位勾选）。
  检定/掷骰范围汇总 → 「随机范围整理」；不要为本步加「机遇裁定」槽。
  不要用本步发明世界观/性格/变量专用执行单元。
boundary: |
  本能力：输出 play_slots（及写手路径的 writing_slots），可选覆盖挂载说明；不写完整 设计.worker集。
  主世界层（gm）几乎总要。旁观维护：有变量/表/规则要程序化盯时才开。转述默认开。
  不再设机遇裁定（chance）槽：真随机走「随机范围整理」+ 程序插入上下文备用数。
  细化终稿：按本步勾选展开 workers、合并常驻与 tables。
  变量设计 / 变量控制上下文：真值与投影，不是推理槽。
  叙事指南与故事推进：挂到转述槽（推进可兼挂主世界层）；世界/机制：挂到主世界层——本步只点名槽。
~~~~

### 21b. 随机范围整理（`random-range`）

人工审查：☑ 已写入 2026-09-07：正文组成前汇总；待你过目可再改

源：`skills/dialogue/world-simulator/modules/random-range/prompt.md`

~~~~
name: 随机范围整理
id: random-range
artifact: 设计.随机范围整理
declaration: >
  上游已有检定/对抗/掷骰需求时：汇总全部要用的随机项与取值范围（含表达式），供程序每轮插入备用随机数；排在正文组成之前
when: |
  机制/生成规则/变量/叙事等上游已出现需要随机数的内容（对抗、检定、抽签、伤害区间等），且尚未收成一份范围表。
  排在「正文组成」之前（通常紧挨其前；回复呈现可并行或略前）。
when_not: |
  全程不靠随机数推进 → 不排。
  还在定「怎么裁定 / 公式本身」→ 先「实现机制」「生成规则」或「变量设计与更新规则」；本步只汇总已定需求。
  只谈前端怎么藏、选壳美化 → 「正文组成」。
  只谈每轮可见区域与字数 → 「回复呈现」。
boundary: |
  本技能：一份清单——每项随机用途、范围或表达式（如力量*5～*10、敏捷检定 1～100）、本轮建议备用条数。
  不写新裁定法则、不写骰子剧情；法则来自上游，此处只整理成程序可读范围。
  游玩拓扑：不再开「机遇裁定」槽；真随机靠本表 + 程序插入上下文。
  正文组成：负责把隐藏备用区接到壳/消息里——本步只交「要插什么数」。
feeds: gm,narrator
~~~~

### 22. 上下文投影排序（`context-order`）

人工审查：☑ 已审查 2026-09-07：用户确认；已去机遇槽残留

源：`skills/dialogue/world-simulator/modules/context-order/prompt.md`

~~~~
name: 上下文投影排序
id: context-order
artifact: 设计.上下文投影排序
declaration: >
  收成前给已启用槽排扁平投影序（含对话.历史）；不发明槽、不重写长文、不演情节选择题
when: |
  游玩槽已确认（或可按默认），且主要上下文块已有可摘要产物，需要决定各执行单元看见什么、以何顺序插入。
  本步为〔程序步〕：上下文已多、即将收成时排入。
when_not: |
  体验/站位仍混沌 → 先「美学纲领与交互范式」。
  槽位未定且用户拒绝默认 → 先「游玩拓扑」。
  上游上下文仍大量空洞、无法判断稳/变 → 先补缺口，勿空排。
  只需勾选槽 → 「游玩拓扑」；上下文很少、只需合并终稿 → 「细化终稿」可按默认序退化。
boundary: |
  本技能：抄名册 → 凭各块 brief/挂载/稳变 给每槽 inserts[]。
  名册权威在程序（及已勾选的游玩拓扑）；本步不增白名单外 id。
  中段技能可带 mount 与稳/变；最终 order 以本步为准。
  细化终稿：把本步排序表收进运行规格 context_order；本步不输出完整 设计.worker集。
  禁止把依赖产物里的游玩示例（迎上去/推开/反客为主 等）当成当前要问的题。
feeds: design_only
~~~~

### 23. 细化终稿（`refine`）

人工审查：☐ 未审查

源：`skills/dialogue/world-simulator/modules/refine/prompt.md`

~~~~
name: 细化终稿
id: refine
artifact: 设计.worker集
declaration: >
  按已勾选槽（或默认槽）与投影排序表收成运行规格；不发明新执行单元
when: |
  至少体验契约可引用；槽已勾选或可按默认；若上下文块已多则宜先有投影排序表。
  需要输出「设计.worker集」才能进游玩时排；编排应将流程导向 closed。
when_not: |
  体验站位未定 → 先「美学纲领与交互范式」。
  不能吃默认槽且尚未勾选 → 先「游玩拓扑」。
  上下文块已多且稳/变未排序 → 先「上下文投影排序」。
  只要改某一块设定长文 → 回头修改对应上游节点，不要用本步重写。
boundary: |
  本能力：合并上游 → 完整运行规格 JSON（interaction、play_slots、context_order/inserts、
  workers 由槽展开、resident_context、tables）。
  游玩拓扑：槽位权威；上下文投影排序：插入序与投影位权威；本步不新增白名单外的 ref。
  变量设计：side_effects / 真值吸入 tables；不创建 variable-update 执行单元。
  进 play 由用户手动决定。
~~~~

### 24. 开场白与开场变量（`opening-setup`）

人工审查：☐ 未审查

源：`skills/dialogue/world-simulator/modules/opening-setup/prompt.md`

~~~~
name: 开场白与开场变量
id: opening-setup
artifact: 设计.开场白与开场变量
declaration: >
  创作终节点：写出 1～多条开场白并钉同真相初值；选定后落库、结束创作并保存定稿
when: |
  收成链已齐（至少体验契约可引用，且「细化终稿」已产出或可立即收成运行规格），需要可开玩的第一段剧情与同真相初值。
  排在收成之后作最后一步。用户要进游玩但还没有第一屏 → 排。
when_not: |
  体验/呈现仍混沌 → 先「美学纲领与交互范式」与「正文组成」等。
  只要改文风不要开场 → 「叙事指南与故事推进」。
  只要改真值规则不要开场文 → 「变量设计与更新规则」。
  运行规格未齐 → 先「细化终稿」。尚未选定开场前若要补前序节点（如 NPC）→ 插在本步之前，勿以「收口已排入」拒绝追加。
boundary: |
  本技能是创作终节点：1～多条开场正文（按正文组成块序）+ 开场变量初值 + 可选监控栏初值示意。
  必须遵守已验收的叙事指南、正文组成、监控栏、变量设计；不重做这些契约。
  具体实例：开场可引用已有实例名片，不在本步新造百科。
  选定后由程序写入 输出.开场白 / 运行.初始变量 / 变量.当前，关闭 DAG 并保存定稿；不要在本步之后再排其它能力。
feeds: narrator
~~~~


---

## 不在本文

| 提示词 | 原因 |
|--------|------|
| `skills/dialogue/world-simulator/workers/design-step/SKILL.md` 与各技能 `task`/`opening`/`output` | 执行 LLM，规划看不见 |
| `skills/dialogue/world-simulator/workers/opening-generator/SKILL.md` | 创作末尾兜底，不是 design-flow |
| `skills/dialogue/world-simulator/orchestrator.md` / `uiPrompt` | 总管 LLM |
| `skills/dialogue/world-simulator/worker-templates/*.yaml` `prompt_excerpt` | 游玩人设 |

执行全文审查可另开文档；选型口径见 `docs/briefs/prompt-revision-inventory.md`。
