# 世界模拟器 · 编排器与能力撰写清单

> 给作者用。用户侧术语：**`docs/ui-glossary.md` §0**。  
> 运行：选配方 → 编排**增量**工作流计划 DAG → `design-step` 执行技能；可再扩步反复调用。  
> **标准范例**：`modules/aesthetics-interaction/prompt.md`。  
> **给外部 AI 的完整泛用规范**：**`docs/briefs/capability-authoring-brief.md`**（项目概述 + 称呼 + 格式契约）。

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
| `opening` | 可选 | **默认问题**正文；程序发给用户，不经 LLM |
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

### 默认问题节奏（通用）

```text
程序发 opening → 用户首答 → LLM（opening + 首答 + 切割后的方法块 + 依赖）
```

有编排参数的能力：先由 design-flow askUser 钉 params → 用户认可 DAG → design-step 注入【本步参数】执行；勿把「生成什么」推迟到执行期。

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
| 美学纲领与交互范式 | `aesthetics-interaction` | **范例已写** |
| 实现机制 | `mechanism` | **已写** |
| 世界蓝图与人文地理 | `world-blueprint` | **已写** |
| 生成规则 | `generation-rules` | **已重写**，可反复；双门槛 + schema + 生命周期；编排必填 `params.target` |
| 具体实例 | `concrete-instances` | **已重写**，可反复；执行预生成规则；编排必填 `params.rule_id` |
| 叙事指南 | `narrative` | **已写** |
| 拓扑图谱 | `topology` | 骨架，待细写 |
| 设计状态栏 | `status-bar` | 骨架，待细写 |
| 变量设计与更新规则 | `variable-design` | 骨架，待细写 |
| 变量控制上下文 | `variable-context` | 骨架，待细写 |
| 设计回复格式 | `reply-format` | 骨架，待细写 |

共用收成（池内保留，按需）：

| 能力 | id | 状态 |
|------|-----|------|
| Worker 规格 | `worker-spec` | **已写**，可反复 |
| 细化终稿 | `refine` | **已写**（产物=`设计.worker集`） |

| 编排器 | 状态 |
|------|------|
| 世界模拟器 | 方法论已写（core/process/principles）；起点：美学纲领与交互范式 |
| 扩写助手 | 方法论已写；起点：美学纲领与交互范式；勿默认套世界模拟全套 |

---

## 验收

1. 只选配方 → 出**近期**创作流程（`status=open`）  
2. design-step 能切割出 `opening`/`task`/…  
3. 有 `opening` 时先程序开场再 LLM  
4. 可追加同能力多次（不同 step.id + params）；收成前 `status=closed`  
5. UI 用编排术语；有编排参数的步骤须展示 params  
6. 缺必填 params 的步骤不得视为可执行（校验失败 / 编排先 askUser）  
