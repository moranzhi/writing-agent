# 实现指南

## 1. 写代码的规则

```text
1. 先读文档，再写对应文件。
2. 一次只写一个文件（或一组强绑定的 types + 实现）。
3. 每写完一个文件，对照本文档的「文件职责」自检。
4. 文件行为与文档冲突时，先改文档，再改代码。
5. 不要跳步实现：下游文件不能先于上游文件。
```

文档是规格，代码是文档的实现。

---

## 2. 文档地图

| 层级 | 文档 | 管什么 |
|---|---|---|
| **系统架构** | **`architecture.md`** | 模块边界、定义/实例、调度、上下文、持久化原则、风险 |
| 运行内核 | `runtime-state-machine.md` | 5 相位、tool 边界、burst |
| 运行内核 | `tool-contracts.md` | 编排器 / worker tool |
| 运行内核 | `context-assembly.md` | 上下文拼接：上半固定、下半动态 |
| 运行内核 | `tag-blackboard.md` | 标签黑板 |
| 持久化 | `book-storage.md` | Book、CardAsset、PlayBook、过程存储 |
| 持久化 | `run-snapshot.md` | 手动存档 |
| UI | `ui-design.md` | 工作台布局、检查器、composer |
| UI | **`ui-glossary.md`** | 用户可见中文口径；禁止裸露内部 id |
| 外部参考 | `references.md` | 按层借鉴的 GitHub 仓库 |
| 本文件 | `implementation-guide.md` | 文件顺序与职责；在现有内核上补齐 |
| **产品体验路线** | **`px-roadmap.md`** | PX0–PX5 交付、DoD、明确不做 |
| **日常 → P0** | **`daily-use-p0.md`** | 日常场景、功能映射、P0 详细工作包 |
| **剧本 / 方法（非系统架构）** | `design-orchestrator-guide.md` | 创作三大步、表/副作用、自检 |
| **剧本 / 方法（非系统架构）** | `creation-playbook.md` | 创作流程概念（指向指导） |
| **剧本 / 方法（非系统架构）** | `world-simulator-modules.md` | 编排器/能力清单与现行包布局 |
| **Skill 格式（非系统架构）** | `orchestrator-skill-format.md` | manifest 写法（非编排表） |
| **Skill 格式（非系统架构）** | `worker-skill-format.md` | SKILL.md、contextSegments |
| **Skill 格式（非系统架构）** | `skill-format.md` | 包存储、registry（示例以 world-simulator 为准） |
| **Skill 格式（非系统架构）** | `skill-design-guide.md` | 包格式薄层 |
| **Skill 格式（非系统架构）** | `preset-format.md` | 预设导入 |
| **能力撰写** | `briefs/capability-authoring-brief.md` | 外部 AI 写 modules 交接 |

许可证占位：仓库根 `THIRD_PARTY_NOTICES.md`。

---

## 3. 在现有内核上补齐（当前优先）

相位机、Agent tool loop、Skill loader、Worker 声明、上下文拼装、表 rev、Web UI、快照 API **已具备**。  
**不要**按绿场「领域库 → Mastra → …」重开；增量挂在现有 `phase-runtime` / Book 存储上。系统边界见 `architecture.md` §11。

**权威执行顺序与验收 DoD → [`px-roadmap.md`](./px-roadmap.md)**（当前焦点 **PX0**）。  
**日常场景与 P0 工作包 → [`daily-use-p0.md`](./daily-use-p0.md)**。

| 路线阶段 | 目标 | 备注 |
|----------|------|------|
| **PX0（当前）** | 编排器 UI + 双线主路径 + 存档硬稳定 | 详见 `daily-use-p0.md` / `px-roadmap.md` |
| PX1–PX2 | 创作/游玩体验打磨；副作用 | UI 仍可抄 |
| PX3 | Trace、预算、规格版本、E2E | — |
| PX4 | 长文加深（P0 已含最小闭环） | — |
| PX5 | 隔离 + 调试；必要时新配方包 | — |
| 延后 | SQLite / 事件溯源 / Mastra·Next | — |

历史分期 A0–E 见下节（**多数已 done，仅作文件职责索引**；进度与验收以 [`px-roadmap.md`](./px-roadmap.md) 为准，勿再按 §9「未开始」判断现状）。

> §3b / §9 中仍可能出现 `design-intake`、`skills/novel/`、缺失文件路径等**历史表述**；磁盘真相见 `skills/dialogue/world-simulator/README.md`。

---

## 3b. 历史实现分期（索引）

### Phase A0 — 可运行阶段机

目标：**不依赖 LLM**，阶段机整体可运行、可手动驱动、可脚本跑通最小闭环。

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| A06 | `src/types/runtime.ts` | done | 5 相位、事件、会话类型 |
| A09 | `src/runtime/phase-machine.ts` | done | 纯函数：`applyEvent`，不调 LLM |
| A20 | `src/runtime/phase-runtime.ts` | done | 运行层：处理 effects，stub worker |
| A21 | `src/cli/phase-demo.ts` | done | 交互式演示 CLI，手动发事件 |
| A22 | `tests/phase-runtime.test.ts` | done | 闭环 + worker 中途提问测试 |

**运行方式：**
```bash
npm run phase-script    # 非交互，自动跑最小闭环
npm run phase-demo      # 交互，手动 /decide /approve /worker-ask
npm run phase-demo -- --auto   # worker 自动占位完成
```

### Phase A1 — 编排器 LLM 接入（阶段机之上）

目标：在 PhaseRuntime 之上接 Main Agent，不改动 phase-machine 规则。

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| A11–A19 | blackboard、llm、main-agent、orchestrator、run.ts | done | 带 Mock/真实 LLM 的完整栈 |
| A15 | `src/main-agent/prompts.ts` | todo | prompt 拆分 |

### Phase A2 — Skill 层（创作指南）

目标：`skills/` 批量存储 SKILL.md；启动第一个询问是选 skill；编排器读 activeSkill。

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| S00 | `skills/registry.yaml` | done | skill 索引 |
| S01 | `skills/novel-standard/SKILL.md` | done | 小说指南（含启动询问） |
| S02 | `skills/theater-roleplay/SKILL.md` | done | 剧场指南（含启动询问） |
| S03 | `src/skills/types.ts` | todo | ParsedSkill、SkillIndexEntry |
| S04 | `src/skills/loader.ts` | todo | 解析 SKILL.md |
| S05 | `src/skills/registry.ts` | todo | listSkills() |
| S06 | `src/skills/resolver.ts` | todo | 推断当前 stage |
| S07 | `src/main-agent/skill-context.ts` | todo | 注入编排器 prompt |
| S08 | `src/runtime/phase-machine.ts` | todo | 增加 skill_selection / skill_selected |
| S09 | `src/cli/phase-demo.ts` | todo | 启动时 /select-skill |

详见 `docs/skill-format.md` §5。

### Phase B — Tool Call 化

目标：编排器 / worker 从 JSON 决策改为 tool call；Runtime 做 tool 校验与事件转换。

### Phase C — 真实 Worker

目标：outline / drafting 等固定 worker 接真实 LLM；worker 可中途 ask_user。

### Phase D — 持久化

目标：book 存储；preset 导入。

### Phase E — 标签黑板迁移（当前文档已完成，代码待做）

目标：代码与 `tag-blackboard.md` 对齐。

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| E01 | `src/types/blackboard.ts` | done | `BlackboardItem`、按 tag 查询 |
| E02 | `src/blackboard/blackboard.ts` | done | listTagIndex、前缀匹配 |
| E03 | `src/skills/types.ts` + `loader.ts` | done | 解析 inputTags / outputTags（兼容 outputKeys） |
| E04 | `src/worker/executor.ts` | done | 按 tag 取 context，校验 outputTags |
| E05 | `src/types/runtime.ts` + `main-agent.ts` + `phase-runtime` | done | 决策去掉 keys；runtime 按 Worker Skill 执行 |
| E06 | `skills/novel/weird-rules-short/` | todo | tag 化 skill 样板 + inputTags frontmatter |
| E07 | `skills/novel/quick-write/` | todo | 简易全量 LLM skill |

编排写在各包 `orchestrator.md`，不单独维护 execution-flow YAML。

---

## 4. Phase A 文件顺序

按序号逐个实现。状态列：`done` = 已有初版，`todo` = 未写或未按文档对齐。

### 4.1 项目配置

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| A01 | `package.json` | done | 项目元数据、npm scripts（dev / test / demo） |
| A02 | `tsconfig.json` | done | TypeScript 编译选项 |
| A03 | `vitest.config.ts` | done | 测试入口配置 |
| A04 | `.env.example` | done | LLM API 环境变量模板，不含真实 key |
| A05 | `.gitignore` | done | 忽略 node_modules、dist、.env |

**A01 职责：** 声明依赖（typescript、tsx、vitest）和三条命令。不含业务逻辑。

---

### 4.2 类型层（只放数据结构，不含逻辑）

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A06 | `src/types/runtime.ts` | done | 相位、事件、会话、产物、ResumeContext | `runtime-state-machine.md` §2–5 |
| A07 | `src/types/blackboard.ts` | done | BlackboardItem、TagIndex | `tag-blackboard.md` §2 |
| A08 | `src/types/tools.ts` | todo | 编排器 tool、worker tool 的参数与结果类型 | `tool-contracts.md` |

**A06 职责：**
- 定义 `RuntimePhase`（5 种）
- 定义 `WaitingReason`（waiting_user 的子原因）
- 定义 `RuntimeEvent`（唯一改变相位的输入）
- 定义 `RuntimeSession`（运行时快照）
- 定义 `PhaseEffect`（阶段机产生的副作用，如 invoke_main_agent）

**A07 职责（Phase E 迁移后）：**
- 定义 `BlackboardItem`（id、tag、content、source、metadata）
- 定义 `BlackboardTagIndex`（给编排器：tag + source，无 content）
- 定义 `BlackboardWrite`（worker 写回）

**A08 职责（Phase B 再写）：**
- `MainAgentToolName`、`WorkerToolName`
- 每个 tool 的 params / result 类型
- tool → event 映射表（类型级注释）

---

### 4.3 阶段机（纯函数，不调用 LLM）

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A09 | `src/runtime/phase-machine.ts` | done | 5 相位阶段机：`applyEvent`、`canApplyEvent` | `runtime-state-machine.md` §6–8 |
| A10 | `src/runtime/state-machine.ts` | done | 废弃别名，re-export phase-machine | — |

**A09 职责：**
- `createSession()` — 创建 idle 会话
- `getAllowedEvents()` — 当前相位允许哪些事件
- `canApplyEvent()` — 事件是否合法（含 waitingReason 校验）
- `applyEvent()` — 纯函数：session + event → 新 session + effects
- `createArtifact()` — 创建产物记录

**约束：**
- 不 import llm、blackboard、main-agent
- 不做 IO
- 所有相位转移必须写进 history

**A10 职责：** 兼容旧 import 路径，后续可删。

---

### 4.4 黑板

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A11 | `src/blackboard/blackboard.ts` | done | listTagIndex、queryByPatterns、write | `tag-blackboard.md` §2 |

**A11 职责：**
- `listTagIndex()` — 给编排器
- `queryByPatterns()` — 给 worker 注入
- `write()` — 按 tag 写回
- `getContentByTag()` / `getLatestByTag()`

---

### 4.5 配置与 LLM

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A12 | `src/config/env.ts` | done | 从环境变量读 baseUrl、apiKey、model | `architecture.md` §2 config |
| A13 | `src/llm/client.ts` | done | OpenAI 兼容 API + MockLlmProvider | — |

**A12 职责：**
- `loadLlmConfig()` — 必须有 key，否则抛错
- `loadLlmConfigOptional()` — 无 key 返回 null，CLI 切 mock

**A13 职责：**
- `LlmProvider` 接口：`complete(messages) → string`
- `OpenAiCompatibleProvider` — 真实 API 调用
- `MockLlmProvider` — 测试 / demo 用预设响应
- apiKey 不出现在 session 或项目文件里

---

### 4.6 编排器 LLM

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A14 | `src/main-agent/main-agent.ts` | done | 编排器：只选 worker，读 tag 索引 | `tag-blackboard.md` §6 |
| A15 | `src/main-agent/prompts.ts` | todo | 编排器 prompt 拆分 | `tag-blackboard.md` §6 |

**A14 职责：**
- `MainAgent.decide(context)` — 调 LLM，返回 `MainAgentDecision`
- `parseMainAgentDecision(raw)` — 解析 JSON（Phase B 改为 parse tool calls）
- `buildMainAgentUserPrompt(context)` — 拼 user prompt
- `DEFAULT_WORKERS` — 第一版可用 worker 列表

**约束：**
- 编排器不读黑板 value
- 编排器不直接改 phase
- 不含 question-worker（提问是 worker 能力）

**A15 职责（可选拆分）：** 把 prompt 从 main-agent.ts 抽出来，方便迭代。

---

### 4.7 编排层

| # | 文件 | 状态 | 干嘛的 | 对应文档 |
|---|---|---|---|---|
| A16 | `src/runtime/orchestrator.ts` | deprecated | 旧入口；用 phase-runtime | `architecture.md` |

**A16 职责：**
- `RuntimeOrchestrator` — 对外 API：start、submitUserInput、approve、accept 等
- `dispatch(event)` — 调 `applyEvent`，处理 `PhaseEffect`
- `runMainAgent()` — phase=running 时调编排器
- `runStubWorker()` — 第一版占位 worker（Phase C 替换）
- `resumeStubWorker()` — worker 中途提问后恢复

**约束：**
- 唯一调用阶段机和编排器的地方
- user 事件（approve / accept）只从 CLI / API 进入，不从 LLM 进入

---

### 4.8 入口与测试

| # | 文件 | 状态 | 干嘛的 |
|---|---|---|---|
| A17 | `src/cli/run.ts` | done | 交互式 CLI：输入、/approve、/accept、/status |
| A18 | `tests/phase-machine.test.ts` | done | 阶段机单元测试 |
| A19 | `tests/orchestrator.test.ts` | done | 编排层 + Mock LLM 集成测试 |

**A17 职责：**
- 读 stdin，转成 orchestrator 方法调用
- 打印 `phase` + `waitingReason`
- `--mock` 或无 API key 时用 MockLlmProvider

---

## 5. Phase B 文件顺序（下一步）

| # | 文件 | 干嘛的 |
|---|---|---|
| B01 | `src/types/tools.ts` | tool 类型定义 |
| B02 | `src/runtime/tool-registry.ts` | 注册 tool、校验参数、tool → event |
| B03 | `src/main-agent/main-agent.ts` | 改为 tool calling 模式 |
| B04 | `src/runtime/tool-handlers/main-agent.ts` | 编排器 tool 处理器 |
| B05 | `src/runtime/tool-handlers/worker.ts` | worker tool 处理器（ask_user / submit） |

**B02 职责：**
- 白名单：当前 phase + waitingReason 下允许哪些 tool
- LLM 调了不允许的 tool → 拒绝，不转事件

---

## 6. Phase C 文件顺序

| # | 文件 | 干嘛的 |
|---|---|---|
| C01 | `src/workers/types.ts` | WorkerDefinition、WorkerRunOutcome |
| C02 | `src/workers/base-worker.ts` | prompt 拼接、tool 执行循环 |
| C03 | `src/workers/outline-worker.ts` | 大纲 worker |
| C04 | `src/workers/drafting-worker.ts` | 正文 worker |
| C05 | `src/runtime/worker-runner.ts` | 替代 orchestrator 里的 stub |

**WorkerRunOutcome（Phase C 核心）：**

```ts
type WorkerRunOutcome =
  | { kind: "complete"; writes: BlackboardWrite[]; summary: string }
  | { kind: "suspend"; questions: string[]; partialWrites?: BlackboardWrite[] }
  | { kind: "fail"; reason: string };
```

- `complete` → `worker_completed` 事件
- `suspend` → `worker_needs_input` 事件
- `fail` → `runtime_failed` 事件

---

## 7. Phase D 文件顺序

| # | 文件 | 干嘛的 |
|---|---|---|
| D01 | `src/flows/types.ts` | ExecutionFlow、ExecutionStep |
| D02 | `src/flows/ghostwriting-flow.ts` | 代笔 flow 配置 |
| D03 | `src/book-storage/store.ts` | Book 持久化 |
| D04 | `src/preset/importer.ts` | SillyTavern 预设导入 |

---

## 8. 单文件完成检查清单

每写完一个文件，确认：

```text
[ ] 文件顶部的职责是否只对应文档里的一节
[ ] 是否 import 了不该 import 的上层模块（阶段机不应 import LLM）
[ ] 是否有对应测试（内核文件必须有）
[ ] 是否更新了本表的状态列（done / todo）
[ ] 是否在 PR / 提交说明里写「这个文件干嘛的」一句话
```

---

## 9. 当前进度

```text
Phase A0（可运行阶段机）  ✅ 完成
  phase-machine + phase-runtime + phase-demo + 测试

Phase A1（编排器 LLM）     ✅ 有初版（orchestrator + run.ts）
  下一步：orchestrator 应基于 PhaseRuntime 重构

Phase B（tool call）      未开始
Phase C（真实 worker）  未开始
Phase D（flow / 存储）  未开始
```

**下一个应写文件：** 让 `orchestrator.ts` 内部组合 `PhaseRuntime`，而不是重复阶段机逻辑。写之前会先说明该文件职责。
