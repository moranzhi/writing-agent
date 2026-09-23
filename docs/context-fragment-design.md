# 上下文片段 · 槽位 · 投影排序（产物与拼装规范）

> 作者与实现共用。用户侧术语见 `ui-glossary.md` §0。  
> 技能撰写契约见 `briefs/capability-authoring-brief.md` §4.7 / §4.9。  
> 真值门控见 `progressive-data-design.md`；拼装见 `context-assembly.md`。

## 1. 问题与分工

创作期不再「发明执行单元清单」，而是产出**可挂载的上下文片段**，再收成固定槽上的运行规格。

| 何时 | 钉什么 | 权威产物 |
|------|--------|----------|
| 中段各技能 | 片段正文 + **挂谁**（mount）+ 可选稳/变 | `设计.*`（`context-fragment.v1`） |
| 游玩拓扑 | **启用哪些固定槽** | `设计.worker规格` → `play_slots` |
| 上下文投影排序（晚） | **扁平投影序**（含「对话.历史」标签） | `设计.上下文投影排序`（`context-order.v1`） |
| 细化终稿 | 合并进运行规格 | `设计.worker集`（含 `play_slots` + `context_order`） |

**挂谁可早、排第几须晚。** 中段禁止写死最终 `order`。

## 2. 固定槽（play_slots）

| 槽键 | 默认 ref | 用户可见 | 默认 |
|------|----------|----------|------|
| `auditor` | `auditor` | 旁观维护 | 开 |
| `gm` | `world-simulator` | 主世界层 | 开 |
| `narrator` | `narrator` | 叙事转述 | 开 |
| `perspective` | `role-decide` | 角色视角 | 关 |

推荐游玩调度：`gm → perspective? → narrator → auditor`。  
旁观维护与叙事转述默认**不注入**「对话.历史」；主世界层按投影排序表裁剪历史。

## 3. 上下文片段：`context-fragment.v1` / 扁形 `artifact.flat.v1`

**投递**（全局）：按 API profile 探测能力选 `json_schema` → `forced_tool` → `json_object`，与具体技能无关。

**技能稿默认 `context-fragment.v1`**：`正文` 为对象树，深度约 **2 层分组 + 叶子**（短字段、string[]，或诊断 `{结论, 依据, 完备度}`）。不要把整柱收成一段散文。扁形 `artifact.flat.v1` 仅为投递兼容；若 `sections[].text` 是 JSON 对象字符串，程序会还原进正文键。

公共外壳：

| 段 | 含义 |
|----|------|
| `schema` / `技能` / `brief` / `mount` / `稳变` | 索引与挂载；不写 `order` |
| `正文` | **产物主体**（技能自定内部维度，但必须有「各个方面」） |
| `自评` | **自评评分**（`维度[]` + 可选薄弱点；维度名按技能） |
| `追问` | **导语 + 题目**（建议选项 / 示例）；可无题则 `题目: []`。程序挂询问卡；不要再抄一份 `askUser` |
| `开放问题` | 未结构化的残项（可选） |

美学步正文：`设定逻辑` + `交互范式` + `美学纲领`（见 `aesthetics-interaction`）。

**验收卡排版约定（美学步已落地，其它节点逐步对齐）**：

| 栏 | 放什么 | 美学步对应 |
|----|--------|------------|
| **左 · 产物** | 最终希望插入游玩上下文的契约正文 | `美学纲领`、`交互范式` |
| **右 · 评估** | 诊断、完备度、待探、区域化等给人验收用的 | `设定逻辑`（参与/内容维度上的结论·依据·完备度） |

外壳另有 `自评`（顶栏分数 pill）与 `追问`（询问卡）。  
**存盘**：三块都在同一 `正文` 里。**注入**：默认 `full` 时整份正文都会进模型——若日后只要左栏进游玩，再改投影，不靠藏 UI。  
实现机制正文：`依据的核心体验` + `支撑点[]` + `支撑点关系[]` + `覆盖检验`（见 `mechanism`）。  
舞台骨架正文：尺度 / 基底与变造 / **社会结构** / **世界状况** / 关键舞台区 / 未展开范围（见 `world-blueprint`）。  
生成规则正文：必要性判断 + `rules[]`（设计判断 + 生成与描写含**配方/表现** + **分级表现** + **单层**产物格式 + 可选池：**方向池**以方向概括为主、例子极少，**元素池**仅封闭集合，旁观抽样只抽元素池 + **数量**与**一次生成**）；自评＝必要性/属性妥当/材料得当/格式准确。  
美学纲领自评仍为：交互范式 / 美学纲领 / 整体协调（勿与生成规则三维混用）。  
叙事指南与故事推进（工序编排）正文：一份全文（纲领/遣词/笔墨/禁忌/推进等）；**整份**双挂转述与主世界层。artifact=`设计.叙事指南与故事推进`。  
对话落盘拆成两份：`设计.叙事指南`（遣词/笔墨/禁忌/写法档）与 `设计.故事推进`（推进 + 用户输入用法）；各自双挂，条件独立落盘。  
回复呈现：每轮终稿给用户看什么（正文/字数/日期/变量）；artifact=`设计.监控栏`（旧称设计监控栏/状态栏）。
正文组成：把回复呈现清单展示给用户（选壳、分区、【正文安全子集】）；artifact=`设计.正文组成`。见 `docs/play-presentation-shells.md`。  
变量设计：真值 + **维护语句** + **Data映射索引**（指向具体实例）+ side_effects。  
变量控制上下文：各槽视野 + **旁观汇总**；mount 含主世界层与旁观维护。  
生成规则：合同挂主世界层 + 旁观（旁观读 rule_id/格式/必要性，描写长文可 summary）。  
开场白与开场变量：开场正文（present.v1，壳与正文组成一致）+ 开场变量初值；用户代入名片优先「主角设定」。可经 opening-generator 落库。  


具体实例正文：`rule_id` + `records[]`（始终数组；单层，键随规则；条数服从规则「一次生成」）；自评＝合规模（只按规则执行）。  
其它技能换掉正文内块名与自评维度名即可，三段外壳不要拆。
## 4. 投影排序：`context-order.v1`（扁平序）

**不要**再把上下文硬拆成「历史前区 / 历史后区」。排序表就是一条投影流水线：

```text
order 0: worker.persona（fixed）
order 1: 设计.实现机制（summary）
order 2: 对话.历史（summary）     ← 历史本身也是标签
order 3: 变量.当前（fields）
order 4: 用户.最新输入（full）
```

```json
{
  "schema": "context-order.v1",
  "brief": "先名册再分配：旁观 + 主世界层 + 转述",
  "play_slots": { "auditor": true, "gm": true, "narrator": true, "perspective": false },
  "slots": [
    {
      "ref": "world-simulator",
      "inserts": [
        { "order": 0, "ref": "worker.persona", "projection": "fixed" },
        { "order": 1, "ref": "设计.实现机制", "projection": "summary" },
        { "order": 2, "ref": "对话.历史", "projection": "summary", "note": "按投影裁剪" },
        { "order": 3, "ref": "变量.当前", "projection": "fields" },
        { "order": 4, "ref": "用户.最新输入", "projection": "full" }
      ]
    }
  ]
}
```

创作期 LLM 也可先写 `agents[]`（`id` 为 `auditor` / `gm` / `narrator` / `perspective` / `chance`，含 `enabled` / `when` / `inserts`）；程序会收成上表的 `slots` + `play_slots`。运行时仍读 `slots[].ref`（worker ref）。

| 字段 | 说明 |
|------|------|
| `order` | 每槽独立扁平数字序；**0 建议为人设** |
| `ref` | 黑板 tag、`worker.persona`、或 **`对话.历史`** |
| `projection` | `fixed` \| `full` \| `summary` \| `fields`——对历史标签也生效 |
| `anchor` | **已废弃**；旧表可读，编排 API 的 `set_anchor` 现表示「移到历史标签前/后」 |

### 4.1 `对话.历史` 标签

- 程序在游玩期维护黑板 tag `对话.历史`（用户输入 + 助手可见输出追加）。
- 排序表里出现该 ref 时，按 **projection** 动态裁剪后注入（不是整段永远塞满）。
- 若尚未写入历史，可用 `运行.事件流` + `用户.最新输入` 拼兜底。
- 投影建议：`summary`（默认）/ `fields`（更短）/ `full`（更长）/ `fixed`（几乎不注入）。

### 4.2 拼装

Runtime 按 inserts 数组顺序拼进单条 user 上下文（`assembleWorkerContext` **不再**按 static/dynamic 重排）。  
`tier` 仅作缓存提示（历史标签之前偏 static，之后偏 dynamic）。

### 4.3 可编排

检查器「上下文投影排序 · 可编排」：

- ↑↓ 调整扁平位置  
- 改 projection  
- 「史前 / 史后」：把该项移到 `对话.历史` 之前或之后  

API：`POST /api/sessions/:id/context-order`（`move` / `set_projection` / `set_anchor` / `replace`）。

## 5. 运行规格落点

`设计.worker集` 含 `play_slots` + `context_order`；无表时可由声明合成（含历史标签）。

## 6. UI 渲染

| schema / 技能 | 友好渲染 |
|--------|----------|
| `context-fragment.v1` 外壳 | brief / 挂载 / **自评十分制（x/10）** / 追问 |
| 美学纲领与交互范式 | mosaic（设定逻辑 / 交互范式 / 美学纲领） |
| 生成规则 | 必要性 + 规则卡（配方/表现、分级表象、单层字段表、方向池/元素池） |
| 舞台骨架 | 尺度 / 社会 / 状况 / 关键区实体卡 |
| 实现机制 | 支撑点卡 + 关系 + 覆盖检验 |
| 其它技能正文 | 通用结构化（KV）；**应补专用卡** |
| `context-order.v1` | 扁平序表；历史行高亮 |

解析失败时勿只甩 JSON 墙：提示无法解析并保留原文折叠。自评 `分数` 契约为 **0–10**（旧百分数会按 /10 兼容显示）。

技能作者：output 键稳定后，须登记或实现对应视图（见 `capability-authoring-brief.md` §4.9「视图」）。

## 7. 配方链路

```text
体验契约 → 确认槽 → 中段片段（mount）→ 投影排序（含对话.历史）→ 细化终稿
```
