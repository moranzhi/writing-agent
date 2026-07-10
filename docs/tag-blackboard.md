# 标签驱动黑板

## 1. 定位

本系统用于多 worker 协作式文本生成，覆盖：

```text
简易小说快速撰写（quick-write）
规则怪谈 / 短篇结构化创作（weird-rules-short 等）
长篇小说 / 交互式写作助手（interactive-novel，TODO）
场景扮演模拟（scene-roleplay，TODO）
角色扮演 / 角色卡互动（并入 scene-roleplay 的 instantiate + run，见 §2）
```

核心思想：

```text
黑板 = 标签化数据池
标签 = skill 之间的接口
skill = SKILL.md 定义的能力；worker = 一次 invoke
Agent = tool loop 内调度 invoke 哪个 skill
Runtime = 按 skill 契约拼接上下文（上半固定、下半动态）
```

一句话：**标签驱动 + agent 选 skill + Runtime 拼上下文**——不是固定流水线，也不是 LLM 自由分发上下文。

上下文拼接见 `docs/context-assembly.md`。不要让 agent 临场改 inputTags；分发由 `inputTags` + `contextSegments` 静态声明。

---

## 2. Skill 定义、实例化与 Book

### 2.1 类比

```text
Skill 包（orchestrator manifest + workers）  = 能力定义（静态）
Session + 黑板 tag                           = 一次运行的实参
Book                                         = 过程、资产、游玩（见 book-storage.md）
play stage                                   = agent invoke run skill
```

**写角色卡、收集设定、启动询问** 都不是独立「产品模式」，而是 **实例化阶段** 的不同形态：把 prerequisite tags 写满，然后才进入运行阶段。

### 2.2 三层阶段（勿混淆）

```text
运行相位（RuntimePhase）
  idle | running | waiting_user | done | error
  系统在等什么。见 runtime-state-machine.md

业务 stage（Book / Session）
  design（实例化）→ play（运行）→ done

tag 阶段（黑板条目 tag 名中的段）
  候选 | 草稿 | 确认稿 | 当前 | 更新
  单条数据的 lifecycle
```

业务 stage **写在各 skill 的 orchestrator.md**，不扩运行相位 enum。

### 2.3 实例化（design）

**职责：** agent 按需 invoke instantiate skill，沉淀 `设计.*` tag；产出 `设计.run_skill清单` 后 declare ready。

```text
选 orchestrator 包
  → design stage：启动询问 → agent invoke instantiate skill（能力库）
  → declare_instance_ready
  → play stage：agent invoke run skill
  → done → 归档 Book（过程 + 资产，见 book-storage.md）
```

可从 Book / CardAsset 加载已有 tag，跳过部分 instantiate skill。

运行相位上，实例化阶段多为 `waiting_user(input)`（启动询问、总管 ask_user）；实例化也可调用 **setup worker**，但仍是 worker（固定 inputTags/outputTags），不是第二个生产总管。

### 2.4 每个 skill 声明什么

在 orchestrator.md 中写清（见 orchestrator-skill-format.md）：

```text
## 启动询问 / ## 实例化
  prerequisiteTags：本 skill 运行前必须有的 tag
  instanceReadyWhen：何时可进入 run stage（文字条件 + tag 列表）
  写入目标 tag（可多个；不必再塞进单一 book.brief）

## 阶段定义
  instantiate（或沿用 stageId brief）→ run（write / review …）→ done

## Worker 编排
  仅 run stage 及之后调度生产 worker；instantiate 阶段只 ask_user 或 run setup worker
```

### 2.5 已有雏形：weird-rules-short

| 业务 stage | 现 stageId | 含义 |
|---|---|---|
| 实例化 | `brief` | 启动询问 → `book.brief`（≈ `需求.核心要点`）→ `startupCompleted` |
| 运行 | `write` | `write-rules` 产出规则与 core |
| 运行 | `review` | 双验收 worker |
| 结束 | `done` | finish |

`basic` 同理：`brief` = 实例化，`outline` worker = 运行。  
文档与实现迁移时，可将 stageId 改名为 `instantiate`，或保留 `brief` 但在 ## 阶段定义 注明 **brief ≡ instantiate**。

### 2.6 角色卡

不再单独维护 `character-card-author` skill 包。角色设定、口吻、行为边界等 tag 在 **扮演类 skill 的 instantiate 段** 收集或生成（可选 setup worker）。  
若需跨 Session 复用，将 `角色.A.设定`、`角色卡.确认稿` 等 **确认稿** 存入 Book，新 Session **加载 Book** 而非再跑完整实例化。

### 2.7 Book 与黑板

```text
黑板（Session 内）   运行时 tag 池；worker 读写
Book（项目级）       长期实例；accepted 确认稿归档；下一场 Session 可加载
```

详见 `docs/book-storage.md`。Session 是一次运行；Book 是一个创作项目（一本小说、一个扮演项目）。

---

## 3. 黑板条目

### 2.1 最小结构

```ts
type BlackboardItem = {
  id: string;
  tag: string;
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
};
```

### 2.2 可选增强

```ts
type BlackboardItem = {
  id: string;
  tag: string;
  content: string;
  source: string;
  scope?: string;
  createdAt?: number;
  updatedAt?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
};
```

### 2.3 字段含义

```text
id           唯一标识，追踪与依赖
tag          标签本体，决定身份与消费路径（核心）
content      具体内容（字符串）
source       产生该条目的 worker id，调试用
scope        作用范围，如当前章节、场景、项目（可选）
dependencies 依赖的其他黑板条目 id（可选）
metadata     置信度、真实性、控制模式等（不参与基础路由）
```

注意：

```text
tag 是核心路由依据。
source 不是路由依据，只用于调试与溯源。
metadata 不参与基础路由，除非某 skill 明确约定。
```

**已废弃：** 旧模型的 `key`、`summary`、`tags[]`、`readableBy`、`writableBy` 作为路由字段。迁移期代码可能仍保留 `BlackboardEntry`，以本文为准逐步替换。

---

## 4. 标签原则

标签不是信息分类学，而是 **工作流接口**。

### 3.1 设计原则

```text
标签越少越好，但必须能区分不同消费路径。
两个信息若永远被同一批 worker 消费，可合并 tag。
若在不同阶段被不同 worker 消费，必须拆分 tag。
若可能被误当成事实，必须加阶段段。
若涉及角色私有认知，tag 里必须体现角色归属。
```

### 3.2 推荐格式

```text
对象.内容
对象.内容.阶段
领域.对象.内容.阶段
```

不强制四段式；按复杂度逐级增加。

示例：

```text
大纲.草稿
事件.草稿
正文.草稿
正文.确认稿

角色.A.行动.候选
角色.A.台词.候选
角色.A.内心想法.候选
角色.A.记忆.当前
```

### 3.3 标签替代的旧字段

```text
角色.A.内心想法.候选
```

已表达：归属 A、类型为内心想法、阶段为候选、消费路径由声明 inputTags 的 worker 决定。

**不需要** 再写 `owner`、`visibleTo`、`type=action` 等平行字段。

### 3.4 匹配规则（Runtime）

Worker frontmatter 声明 `inputTags`：

```yaml
inputTags:
  - "需求.核心要点"      # 精确匹配
  - "角色.A.*"          # 前缀匹配：tag 以「角色.A.」开头
  - "大纲.*.草稿"       # 前缀匹配
```

规则：

```text
无通配 → 精确匹配 tag
以 .* 结尾 → 前缀匹配（实现优先于完整正则）
多条命中 → 默认按 updatedAt 取最新；或 worker 声明 inputMerge: concat | latest
```

总管调度时也可对 **tag 索引**（不含 content）做存在性判断，例如「是否有 规则.确认稿」。

---

## 5. 阶段标签

阶段表示同一类信息在不同生命周期下的语义。

```text
候选     worker 生成的可能内容，不等于事实
草稿     生成中的文本或结构
确认稿   用户或流程确认，可进入长期状态
当前     当前生效状态
更新     状态变化结果
```

重要规则：

```text
候选 ≠ 已发生。
草稿 ≠ 确认稿。
角色行动候选不能直接写入长期记忆。
长期记忆优先从正文.确认稿 与明确 记忆.更新 生成。
```

验收（`user_confirmed` / `programmatic_review`）通过后，Runtime 将对应产物 tag 从 `.草稿` 升级为 `.确认稿`（或写入新的确认稿条目并标记旧草稿 superseded）。

---

## 6. Worker

每个 worker 是固定的标签消费者和生产者。

### 5.1 类型

```ts
type WorkerDefinition = {
  id: string;
  name: string;
  description: string;
  inputTags: string[];
  outputTags: string[];
  inputMerge?: "latest" | "concat";
  run: (context: WorkerContext) => Promise<WorkerResult>;
};

type WorkerContext = {
  taskId: string;
  workerId: string;
  items: BlackboardItem[];
  params?: Record<string, unknown>;
};

type WorkerResult = {
  items: BlackboardItem[];
  logs?: string[];
  askUser?: string[];
};
```

### 5.2 规则

```text
worker 只能读取 inputTags 声明的标签（含前缀规则）。
worker 只能输出 outputTags 声明的标签。
worker 不读取全量黑板。
LLM 不决定自己能看什么。
Runtime 校验 outputs 的 tag  ⊆ outputTags。
```

### 5.3 Worker Skill 落盘

见 `docs/worker-skill-format.md`。正文写「怎么做」；`inputTags` / `outputTags` 写在 frontmatter。

### 5.4 ask_user

提问是 worker **能力**，不是独立 worker。中途提问时 `resumeContext` 保存 workerId，**不**保存 inputTags（恢复时仍从 Worker Skill 读 inputTags）。

---

## 7. 总管（Main Agent）

总管只负责流程推进。

### 6.1 职责

```text
判断当前任务属于哪种 skill / 业务阶段
选择下一个 worker（run_worker）
判断是否需要追问用户（ask_user）
判断是否需要用户确认下一步（requiresApproval）
判断是否 finish
```

### 6.2 不负责

```text
不决定某条信息给谁看
不手动拼接 worker 上下文
不让 LLM 判断信息权限
不把全量黑板交给 worker
不在 run_worker 里指定 inputTags / outputTags
```

### 6.3 决策结构

```ts
type MainAgentDecision = {
  id: string;
  action: "ask_user" | "run_worker" | "create_temp_worker" | "review_blackboard" | "finish";
  reason: string;
  workerId?: string;
  requiresApproval: boolean;
  statePatchAllowed: false;
};
```

执行链：

```text
总管选择 worker
→ Runtime 读取该 worker 的 inputTags
→ 从黑板取匹配条目，组装 WorkerContext
→ 调用 worker
→ worker 输出固定 outputTags
→ 写回黑板
→ 按 acceptanceMode 验收
```

Tool 合约见 `docs/tool-contracts.md`。

---

## 8. Skill 包与 manifest

Skill 包 = `orchestrator.md`（manifest）+ `workers/*/SKILL.md`。详见 `orchestrator-skill-format.md`。

manifest 包含：

```text
Skill 注册表（instantiate + run）
验收策略
Instance Ready 规则
```

**不写** 逐步编排表。inputTags / contextSegments 在 Worker SKILL.md。

### 8.1 已启用包

| 包 | 说明 |
|---|---|
| `novel/basic` | 演示：需求 → 大纲 |
| `novel/weird-rules-short` | 规则怪谈：写 + 双验收 |

### 8.2 规划包（见 `skills/README.md`）

| 包 | 说明 |
|---|---|
| `novel/quick-write` | **简易档**：几乎无 tag 路由，上下文全量给 LLM |
| `novel/interactive-novel` | 长篇 / 写作助手：instantiate + 多轮 run |
| `novel/novel-standard` | 标准流水线（或与 interactive 合并） |
| `dialogue/scene-roleplay` | 场景扮演（含角色设定 instantiate + 互动 run） |

---

## 9. 各模式核心 tag（参考）

实现 skill 时从下列词汇出发，不必一次全部实现。

### 8.1 简易小说（quick-write）

极简；可大量依赖 session + 全量上下文，tag 仅作交付锚点：

```text
用户.输入
需求.摘要
正文.草稿
正文.确认稿
```

### 8.2 结构化短篇（如 weird-rules-short）

迁移目标示例（与现 key 对照实施）：

```text
需求.核心要点        ← book.brief
核心.危险.隐藏       ← core.danger
规则.草稿            ← rules.draft
规则.说明.草稿       ← rules.commentary
验收.读者视角.记录   ← review.infer.notes
验收.作者视角.记录   ← review.author.notes
```

### 8.3 交互式长篇

```text
用户.原始输入 | 用户.意图转述 | 用户.确认结果
项目.设定 | 项目.风格要求
大纲.当前 | 大纲.候选修改 | 大纲.确认稿
事件.当前 | 事件.确认稿
正文.原文 | 正文.续写锚点 | 正文.草稿 | 正文.确认稿
记忆.长期摘要 | 记忆.确认稿
```

### 8.4 场景扮演

```text
用户.行动输入 | 用户.行动意图
世界.规则 | 世界.当前状态 | 世界.隐藏状态
场景.可见信息 | 场景.隐藏信息
角色.{id}.记忆 | 信念 | 行动.候选 | 台词.候选
行动.裁决结果
输出.场景反馈
更新.世界状态 | 更新.角色状态
```

### 8.5 角色卡

撰写：`角色卡.草稿` → `角色卡.确认稿`  
游玩：读 `角色卡.确认稿` + `用户.控制模式` + `NPC.*`

---

## 10. 正文 worker 与角色候选

角色 worker 输出 `角色.*.台词.候选` 等，**不**直接进入正文事实。

正文 worker 读取候选 + 风格约束，输出 `正文.草稿`；用户确认后为 `正文.确认稿`。

```text
角色候选 → 提供意图
正文 worker → 文本化、风格化、叙事化
正文.确认稿 → 最终发生与表达
```

---

## 11. 可选增强

### 10.1 采用记录

```text
tag: 采用.记录
```

记录正文采用了哪些候选条目，避免未采用候选污染记忆。早期可省略，记忆 worker 只从 `正文.确认稿` 抽取。

### 10.2 真实性 / 置信度（metadata）

```ts
type TruthMode =
  | "truth" | "belief" | "claim" | "lie" | "rumor" | "plan" | "unknown";
```

不参与基础路由。

### 10.3 RAG

RAG 不替代黑板。检索结果也应写成 tag，例如 `角色.A.相关记忆摘要`，由 worker 通过 inputTags 读取。

---

## 12. 与阶段机的关系

运行相位、业务 stage、tag 阶段 **三者正交**（详见 §2.2）：

```text
运行相位     系统在等什么（见 runtime-state-machine.md）
业务 stage   instantiate → run → done（orchestrator.md；brief 即 instantiate）
tag 阶段     黑板条目 lifecycle（候选 / 草稿 / 确认稿）
```

实例化阶段在运行相位上通常体现为 `waiting_user(input)`；进入 run stage 后为 `running` + worker 验收循环。  
阶段机 enum 不增加 `instantiate` 相位——业务 stage 由 orchestrator + tag 索引判断。

阶段机规则本身不因 tag 迁移而改变。变的是：黑板读写、worker 上下文、总管决策字段。

---

## 13. 与 Book 存储

Book 存长期实例；黑板存 **当前 Session** 的运行时 tag。实例化产物与 run 阶段确认稿可归档到 Book。  
详见 `docs/book-storage.md` 与 §2.7。

---

## 14. 实现原则（必须遵守）

```text
1. worker 不读取全量黑板（quick-write 等显式声明全量 inputTags 的 skill 除外）。
2. worker 只能读取 inputTags 声明的标签。
3. worker 只能输出 outputTags 声明的标签。
4. LLM 不决定上下文分发。
5. 总管 run_worker 时不带 inputTags / outputTags。
6. 标签是 worker 之间的接口。
7. 候选不等于事实；草稿不等于确认稿。
8. 正文 worker 可重写角色候选产物。
9. 长期记忆优先从正文.确认稿 更新。
10. 简单 skill 用简单 tag；复杂 skill 再增加对象与阶段段。
11. 角色卡与设定在 instantiate 阶段写入 tag；跨 Session 复用走 Book 加载，不单独 author skill 包。
12. 代码与旧文档冲突时，以本文为准改代码。
```

---

## 15. 代码迁移顺序（参考）

```text
1. src/types/blackboard.ts → BlackboardItem + listByTag / matchPrefix
2. src/skills/types.ts + loader → 解析 inputTags / outputTags
3. src/worker/executor.ts → 按 tag 组装 context，校验 outputTags
4. src/types/runtime.ts + main-agent → 决策去掉 inputKeys / outputKeys
5. skills/novel/weird-rules-short → 第一个 tag 化样板
6. skills/novel/quick-write → 简易全量 LLM 档
```

当前代码仍为旧 key 模型；实现前以本文为规格。

---

## 16. 相关文档

| 文档 | 内容 |
|---|---|
| `orchestrator-skill-format.md` | 总管 orchestrator.md 写法 |
| `worker-skill-format.md` | Worker SKILL.md 写法 |
| `tool-contracts.md` | 总管 / worker tool |
| `skill-format.md` | Skill 包存储 |
| `runtime-state-machine.md` | 5 相位阶段机 |
| `implementation-guide.md` | 写代码顺序 |
| `skills/README.md` | Skill 包索引与 TODO |
