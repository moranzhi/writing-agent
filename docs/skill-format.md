# Skill 格式与存储

## 1. 定位：两层 Skill

本项目有 **两种 Skill 文档**，不要混在一个文件里：

| 类型 | 路径 | 消费者 | 写什么 |
|------|------|--------|--------|
| **总管 Skill** | `skills/{bookKind}/{name}/orchestrator.md` | Main Agent | **何时**调哪个 worker、验收方式、启动询问 |
| **Worker Skill** | `workers/{workerId}/SKILL.md` | Worker Agent | **inputTags/outputTags**、怎么做 |

```text
选 weird-rules-short（总管 Skill）
  → 总管：brief 齐了 → run ruleset-worker，input=[project.brief]
  → Worker：读 workers/ruleset-worker/SKILL.md → 写 core / rules / commentary
  → 总管：rules accepted → run review-worker
  → Worker：读 workers/review-worker/SKILL.md → 评估怎么做
```

**何时评估** = 总管 Skill 的 Worker 编排表。  
**如何评估** = review-worker 的 Worker Skill。

详细规范：

- 总管 Skill → `docs/orchestrator-skill-format.md`
- Worker Skill → `docs/worker-skill-format.md`

旧称「Skill = 创作说明书」仍成立，但说明书 **拆成编排（总管）与执行（worker）两份**。

```text
会话开始
  → 询问 1：选哪个总管 Skill（skills/{bookKind}/{name}/orchestrator.md）
  → 加载总管 Skill
  → 询问 2：读总管 Skill「## 启动询问」
  → 之后总管按「Worker 编排」调度；Worker 读本 skill 包内 workers/{id}/SKILL.md
```

---

## 2. 存储位置

Skill 以 **Skill 包（skill pack）** 为单位：一个总管 + 其专属 workers，**同包绑定，不跨包复用 worker**。

```text
skills/
├── registry.yaml
├── novel/                                    # Book 形态
│   ├── basic/
│   │   └── orchestrator.md                   # 总管 Skill
│   ├── weird-rules-short/
│   │   ├── orchestrator.md                   # 总管：何时调谁、黑板 key
│   │   └── workers/                          # 本总管专属，不与其他 skill 共享
│   │       ├── write-rules/
│   │       │   └── SKILL.md                  # 规则怪谈：怎么写规则+解析
│   │       └── review/
│   │           └── SKILL.md                  # 规则怪谈：怎么检查
│   └── novel-standard/
│       ├── orchestrator.md
│       └── workers/
│           ├── outline/SKILL.md
│           └── drafting/SKILL.md
└── dialogue/
    └── theater-roleplay/
        ├── orchestrator.md
        └── workers/
            └── turn/SKILL.md
```

规则：

```text
第一层文件夹 = bookKind（novel | dialogue），决定 Book 存储结构
第二层文件夹 = 一个 skill 包，名与 frontmatter.name 一致
  orchestrator.md   总管 Skill（编排、启动询问、验收）
  workers/{id}/     本包专属 worker；id 在包内唯一即可
Worker 不复用：novel-standard 的 outline worker ≠ weird-rules-short 的任何 worker
registry.yaml 的 path 指向 orchestrator.md，如 novel/weird-rules-short/orchestrator.md
```

**为何不复用 worker：** 同一「产出形状」（如规则表）在不同总管下的写法、Rubric、自检完全不同；共享 worker 会把体裁细节塞进总管或搞混上下文。需要相似流程时 **复制 worker 包再改**，而不是引用全局 worker。

与 Cursor skill 的区别：

| | Cursor Skill | 本项目 Skill |
|---|---|---|
| 位置 | `.cursor/skills/` | `skills/` |
| 触发 | Agent 自动或显式引用 | **会话开始必须选一个** |
| 内容 | 通用任务指南 | **创作流程 + 思维链 + 询问策略** |
| 消费者 | Cursor Agent | 总管 LLM |

---

## 3. SKILL.md 结构

### 3.0 两层分类（重要）

Skill 分类分**两层**，不要混为一层：

```text
第一层：Book 形态（category / bookKind，选定后不可换）
  novel     类小说存储：卷、章、大纲、正文（含各类小说子类型）
  dialogue  多轮多角色对话：回合、角色、场景（roleplay / 剧场）

第二层：具体 Skill 包（name，用户启动时选）
  每个包 = orchestrator.md + workers/，不是 category 下的平铺 .md 枚举。
```

示例：

```text
category: novel          ← 第一层：Book 怎么存
name: novel-standard       ← 第二层：标准长篇流程
name: weird-rules-short    ← 第二层：规则怪谈短篇（仍是 novel Book）
name: basic               ← 第二层：最小演示

category: dialogue
name: theater-roleplay     ← 第二层：剧场式多角色互动
```

**不要把「规则怪谈」做成与 novel 平级的 category。**  
规则怪谈是 **novel 形态下的专精 skill**，用 `name` + `tags` 区分：

```yaml
---
name: weird-rules-short
description: 短篇规则怪谈：从隐含核心反推护命规则，再成章撰写。
category: novel
bookKind: novel
tags: [novel, weird_rules, short, horror]
---
```

| 层级 | 字段 | 谁选 | 例子 |
|---|---|---|---|
| Book 形态 | `category` / `bookKind` | 选 skill 时确定，之后不变 | `novel` / `dialogue` |
| 具体流程 | `name` | 启动询问 1：选哪个 SKILL.md | `weird-rules-short` |
| 体裁标签 | `tags` | 可选，供匹配与过滤 | `weird_rules`, `standard` |

启动 UI 可以按 `category` 分组展示，组内列出多个 `name`（如「小说」下：标准长篇、规则怪谈短篇、…）。

参考 Cursor `SKILL.md`：YAML frontmatter + Markdown 正文。

```markdown
---
name: novel-standard
description: >-
  标准长篇小说创作：先简报、再大网、事件细化、正文。
  适用于用户要写小说、章节、大纲时使用。
category: novel
version: 1
defaultFlowId: ghostwriting-flow
tags: [novel, outline, draft]
---

# 标准小说创作

## 启动询问

（流程 2：选 skill 后向用户展示什么、必收集项、写入 book.brief）

## 创作总纲

（给总管：这类内容是什么、总体顺序、禁忌）

## 总管思维链

（每轮决策前先检查什么、如何选 worker）

## 推荐阶段

（brief → outline → plotline → style → draft）

## 询问策略

### 总管应先问
### 交给 Worker 问

## 推荐 Worker

## 示例
```

### 3.1 Frontmatter 字段

```yaml
---
name: novel-standard                    # 必需，唯一 id，[a-z0-9-]
description: >                          # 必需，供启动时向用户展示、供总管匹配
  第三人称描述 WHAT + WHEN。
category: novel                         # 必需：Book 形态，见 §3.0
bookKind: novel                         # 建议与 category 对齐；选定后 Book 结构固定
version: 1
defaultFlowId: ghostwriting-flow        # 可选，绑定 execution flow
defaultPresetId: writing-default        # 可选
tags: [novel, standard]                 # 体裁/子类型标签，如 weird_rules、short
suggestedWorkers:                       # 可选，本 skill 常用 worker
  - outline-worker
  - plotline-worker
  - drafting-worker
---
```

| 字段 | 必需 | 用途 |
|---|---|---|
| `name` | ✅ | skill id；通常与文件名一致（不含 .md） |
| `description` | ✅ | 启动选择列表展示；总管判断用户描述是否匹配 |
| `category` | ✅ | 与 `bookKind` 一致：`novel` \| `dialogue` |
| `bookKind` | 建议 | 选定后 Book 结构固定；缺省时由所在文件夹推断 |
| `tags` | | 体裁细分：`weird_rules`、`standard` 等 |
| `path` | registry | 相对路径，如 `novel/weird-rules-short.md` |
| `defaultFlowId` | | 选中后默认 execution flow |
| `suggestedWorkers` | | 总管选 worker 时的白名单提示 |

### 3.2 撰写标准：写作生命周期（推荐）

Skill 文件本质上是**给 LLM 与 Runtime 读的字符串规格**。下面这套「触发 → 写前 → 写中 → 写后 → 质量维度」与现有阶段机、验收模式对齐，**应作为所有 skill `.md` 的撰写标准**。

```text
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  触发条件    │ → │  写作前      │ → │  写作中      │ → │  写作后      │ → │  质量维度    │
│  何时激活    │   │  需求分析    │   │  分步引导    │   │  自检润色    │   │  可量化 Rubric│
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
     frontmatter        启动询问          推荐阶段          自检清单         质量评估标准
     + tags             + 创作总纲        + 示例/约束       + 验收策略       + 接受度(预留)
                        + 询问策略        + 禁用行为
```

#### 与正文章节的对应关系

| 生命周期 | 对应章节 | 写什么 |
|---|---|---|
| **触发条件** | frontmatter `description` + `tags` | 何时应选本 skill；用户说什么话时应匹配（如「规则怪谈」「短篇怪谈」） |
| **写作前 · 需求分析** | `## 启动询问` + `## 创作总纲` | 对象、受众、语气、目标、禁忌；**禁止直接动笔**；写入哪个 key |
| **写作中 · 分步引导** | `## 推荐阶段` + `## 示例` + `## 禁用行为` | 阶段链、每步约束、好/坏示例；对应 worker 与产出 key |
| **写作后 · 自检润色** | `## 自检清单` + `## 验收策略` | 产出前检查点；LLM 自审 vs 人工 vs 程序验收 |
| **质量评估** | `## 质量评估标准` | 可量化维度 + 各 stage 的 acceptanceMode |
| **编排** | `## 总管思维链` + `## 询问策略` + `## 推荐 Worker` | 总管如何调度；谁向用户提问 |

不必每个 skill 都写独立 `# 写作前` 大标题；**用统一章节名即可**，内容覆盖上表即可。

#### `## 质量评估标准`（必需）

避免只写「写得更好」。每个 skill 应列出 **可检查的质量维度**，格式建议：

```markdown
## 质量评估标准

| 维度 | 说明 | 检查方式 |
|---|---|---|
| 完整性 | 是否满足启动询问中的必收集项 | programmatic / 人工 |
| 体裁符合 | 是否符合创作总纲（如规则怪谈：规则可反推危险） | LLM 自审 + 人工 |
| 一致性 | 与已 accepted 上游产物是否矛盾 | programmatic |
| **接受度** | 用户/系统是否接受该产物（预留） | user_confirmed → 记录 accept/reject |

各 stage 默认 acceptanceMode 见「验收策略」。
```

**「接受度」维度（预留）：**

- 第一版：**不强制数值打分**；用阶段机的 `user_accepted_artifact` / `reject` 记录二元结果即可。
- 后续可在 Book / Session 元数据写入 `acceptanceScore` 或 `acceptanceNotes`（字符串或 1–5 分），与 Skill Rubric 对齐。
- Skill 里写清楚：**接受度由验收事件沉淀，不由 LLM 自报分数代替人工。**

#### `## 自检清单`（必需）

写作后、提交验收前，worker 或总管应过的检查点（字符串列表即可）：

```markdown
## 自检清单

### rules.draft 提交前
- [ ] 每条规则能否对应非玄学的危险动机？
- [ ] 是否未直接写出 core.danger？
- [ ] 是否无「违反即抹杀」空规则？

### content.chapter.* 提交前
- [ ] 是否遵守 rules.draft 已 accepted 版本？
- [ ] …
```

与 `programmatic_review` 的关系：自检清单 = LLM/人读的规范；程序验收 = 可机械执行的子集。

#### 模板骨架（`skills/{bookKind}/{name}.md`）

```markdown
---
name: …
description: …          # 触发条件（WHEN）
tags: …
category / bookKind: …
suggestedWorkers: …
---

# 标题

## 启动询问              # 写作前 · 需求分析
## 创作总纲
## 总管思维链
## 推荐阶段              # 写作中 · 分步引导
## 询问策略
## 推荐 Worker
## 示例                  # 写作中 · 约束与范例
## 禁用行为
## 自检清单              # 写作后
## 验收策略              # 写作后 · 与 acceptanceMode 绑定
## 质量评估标准          # Rubric + 接受度（预留）
## Book 结构             # 可选，novel / dialogue 形态说明
```

代码当前**结构化解析**的仍主要是 `## 启动询问`；其余章节整段注入总管 prompt（待 `buildSkillContext`）。**全部是 Markdown 字符串，不矛盾。**

### 3.3 正文必需章节（检查清单）

| 章节 | 生命周期 | 内容 |
|---|---|---|
| frontmatter | 触发 | name、description、tags、bookKind |
| **启动询问** | 写前 | 必收集项、写入 key |
| **创作总纲** | 写前 | 顺序、边界、体裁原则 |
| **推荐阶段** | 写中 | 阶段链、worker、产出 key、prerequisites |
| **示例** | 写中 | 好/坏对照或完整流程范例 |
| **禁用行为** | 写中 | 绝对不要做的事 |
| **自检清单** | 写后 | 提交验收前的检查点 |
| **验收策略** | 写后 | 各 stage 的 acceptanceMode |
| **质量评估标准** | 质量 | 可量化维度 + **接受度（预留）** |
| **总管思维链** | 编排 | 每轮决策检查 |
| **询问策略** | 编排 | 总管问 vs worker 问 |
| **推荐 Worker** | 编排 | 与 suggestedWorkers 一致 |

可选：`## Book 结构`、`examples.md` 外链。

---

## 4. registry.yaml（可选）

启动时列举可用 skill，不必扫描目录：

```yaml
skills:
  - name: novel-standard
    description: 标准长篇小说：大纲 → 事件 → 正文
    category: novel
  - name: weird-rules-short
    description: 短篇规则怪谈：隐含核心 → 护命规则 → 成章
    category: novel
  - name: theater-roleplay
    description: 剧场式角色扮演：角色 → 场景 → 回合互动
    category: dialogue
  - name: forum-thread
    description: 论坛体连载：楼主身份 → 回帖风格 → 楼层
    category: novel
```

若无 `registry.yaml`，Runtime 扫描 `skills/novel/*.md` 与 `skills/dialogue/*.md`。
**registry 列举的是第二层 skill（name），不是 category。**

---

## 5. 会话启动：第一个询问是选 Skill

Skill 选择发生在**任何创作逻辑之前**。

### 5.1 启动转移

```text
idle
  session_started
    → waiting_user(skill_selection)
```

新增 `waitingReason`：

```ts
| { kind: "skill_selection"; availableSkills: SkillIndexEntry[] }
```

### 5.2 向用户展示

```text
请选择创作类型：

【小说】（Book 形态：卷 / 章）
  1. novel-standard — 标准长篇：大纲 → 事件 → 正文
  2. weird-rules-short — 短篇规则怪谈：核心 → 规则 → 成章
  3. basic — 最小演示

【对话】（Book 形态：回合 / 多角色）
  4. theater-roleplay — 剧场式角色扮演

也可直接描述你想写什么，我会帮你匹配 skill name。
```

### 5.3 用户回答方式

```text
输入编号或 name：novel-standard
输入自然语言：我想写一个剧场扮演
输入自定义：用 novel-standard，但是偏悬疑
```

Runtime 解析为 `skill_selected` 事件：

```ts
{ type: "skill_selected"; payload: { skillId: string; userHint?: string } }
```

然后：

```text
加载 skills/{skillId}/SKILL.md
解析 ## 启动询问 → session.slots.activeSkill
  → waiting_user(input)
     message 来自 SKILL.md「启动询问·向用户展示」
     必收集项 / 写入目标 同样来自该节
```

### 5.4 两阶段启动

```text
询问 1（系统）  skill_selection   「用哪个 skill？」→ registry / description
询问 2（skill）  input             「启动询问」章节   → 每类内容问的不同
```

**只有询问 1 是系统固定的。询问 2 及之后所有创作逻辑，都在 SKILL.md 里。**

---

## 6. 总管如何使用已选 Skill

`session.slots.activeSkill` 加载后，总管 prompt 注入：

```text
当前 skill: novel-standard
category: novel
创作总纲: （SKILL.md 摘要或全文）
当前推荐阶段: outline（由 resolver 根据黑板推断）
询问策略: 总管应先问 brief；outline 细节交给 worker
建议 worker: outline-worker, drafting-worker
defaultFlowId: ghostwriting-flow
```

总管决策仍通过 tool / JSON 决策，**不**直接改 phase。

---

## 7. 示例

完整示例见仓库内真实文件（不要只在文档里维护一份）：

```text
skills/novel/weird-rules-short.md
skills/dialogue/theater-roleplay.md
```

---

## 8. 解析与加载（将来代码）

| 文件 | 干嘛的 |
|---|---|
| `src/skills/types.ts` | SkillIndexEntry、ParsedSkill 类型 |
| `src/skills/loader.ts` | 扫描 skills/、解析 frontmatter + 正文 |
| `src/skills/registry.ts` | 读 registry.yaml 或目录扫描 |
| `src/skills/resolver.ts` | 根据黑板 index 推断当前 stage |

加载流程：

```text
listSkills() → SkillIndexEntry[]
loadSkill(skillId) → ParsedSkill（含 startupInquiry 解析自 ## 启动询问）
selectSkill(session, skillId) → session.slots.activeSkill
getStartupPrompt(activeSkill) → 流程 2 展示文案
buildSkillContext(activeSkill, blackboardIndex) → 总管 prompt 片段
```

---

## 10. 与 creation-playbook.md 的关系

`creation-playbook.md` 描述**概念与数据结构**（Playbook、Stage、InquiryPolicy）。

**本文件**描述**落盘格式**（SKILL.md 怎么写、放哪、启动时怎么选）。

关系：

```text
Creation Playbook（概念）
  = SKILL.md（存储）+ stages.yaml（可选结构化）
  + session.slots.activeSkill（运行时）
```

`creation-playbook.md` 中的 TS 类型，实现时可从 SKILL.md 解析或从 stages.yaml 读取。

---

## 11. 第一版范围

```text
skills/ 目录 + 2 个示例 SKILL.md（novel、theater）
启动 → skill_selection → 用户选择 → 加载 skill
总管 prompt 注入 skill 摘要
registry.yaml 可选
```

不做：

```text
skill 可视化编辑器
运行时 LLM 自动生成 skill
与 Cursor .cursor/skills 混用（路径独立）
```
