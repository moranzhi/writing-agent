# 本地多 Agent 文本创作系统架构

## 1. 文档定位

本文档描述**系统级运行内核**：模块边界、创作定义与运行实例如何分离、编排器 / 执行单元 / Skill / 上下文如何协作、数据如何持久化，以及外部项目按层借鉴的原则。

本文档**不**设计具体技能包的提示词、步骤或字段。工作流计划与创作方法见独立文档（如 `design-orchestrator-guide.md`）；Skill 包格式见 `skill-format.md` 系列。

---

## 2. 产品目标

本地运行的多 Agent 文本生成平台，兼容多种创作模式（角色扮演、长短篇小说、仿写扩写、思想实验、信息隔离模拟、世界观/角色卡/模板创作、动态表与长期状态、存档分支等）。

这些模式共享同一运行内核，区别来自：

- 装载哪些 Skill / 技能包
- 实例规格（Worker 声明）如何配置
- 上下文如何按契约编译
- 对状态读写实施什么权限

不为每一种创作模式各实现一套固定工作流。

---

## 3. 核心架构原则

### 3.1 创作定义与运行实例分离

| 层 | 当前实现对应 | 含义 |
|----|--------------|------|
| **创作定义 / 规格** | accept 后的 `设计.worker集`、静态设定 tag；可存为 `instance` / `opening` 快照 | 可复用的「函数声明」：Worker、表、常驻上下文、权限与能力边界 |
| **运行实例** | Book + Session + 黑板 + `run` 快照 | 一次具体创作/游玩过程：对话、变量、轮次、中间产物 |

同一规格可多次开档；实例应**钉住**某次规格截面。规格更新后，已有实例不自动跟随；需显式加载/迁移到新截面。

语义上：`instance` 快照 ≈ 已发布的规格版本；`run` 快照 ≈ 运行过程存档。正式 `DefinitionVersion` 发布与迁移协议在现有快照之上增量补齐，不另起一套推倒重写。

### 3.2 编排器只负责任务调配

编排器（Main Agent）负责：判断目标是否完成、决定下一项任务、选择 Worker、必要时询问用户或结束。

编排器**不**负责：直接创作最终正文、临场拼接完整上下文、绕过权限读私有信息、直接改正式状态、同时兼创作与评测、把隐藏推理写入长期状态。

任务所需信息由编排器**声明意图**（如 invoke 哪个 worker）；真正发给 Worker 的上下文由 Runtime 的上下文编译器按 Skill / 声明契约生成。

### 3.3 Agent 决策与程序控制分离

| Agent（非确定） | Runtime（确定） |
|-----------------|-----------------|
| 下一步做什么 | 权限与声明校验 |
| 调用哪个能力 | 上下文装载与 Token 裁剪 |
| 是否返工 / 问用户 | 状态提交、表 `rev` 合并 |
| | 相位边界、burst、失败处理 |

不能依赖提示词保证权限与信息隔离；访问限制在 Tool 与 Context Compiler 层执行。

### 3.4 动态调度，不用固定创作 DAG

「下一步 invoke 哪个 skill」由 agent tool loop 决定。

**5 相位阶段机**（`idle` / `running` / `waiting_user` / `done` / `error`）是并发与权限模型——谁可动、何时等用户、产物何时算事实——**不是**流水线计划。详见 `runtime-state-machine.md`、`tool-contracts.md`。

确定性后台流程（导入导出、索引、迁移、批量评测）可用固定步骤；整场 AIRP / 小说创作流程不固化为完整 DAG。

---

## 4. 总体架构

```text
┌─────────────────────────────────────────────┐
│           Web / Electron Frontend           │
│     创作 / 游玩 / 存档 / 检查器 / 调试         │
└─────────────────────┬───────────────────────┘
                      │ HTTP（+ 流式事件）
┌─────────────────────▼───────────────────────┐
│              Application API                │
│     Book、Session、快照、资源、模型配置        │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│              Agent Runtime                  │
│  Main Agent（tool loop）                    │
│  Phase Machine + Phase Runtime              │
│  Skill Registry / Worker 声明校验           │
│  Context Compiler（assembleWorkerContext）  │
│  Commit：黑板写入、表 rev、acceptance        │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│           Domain / Storage                  │
│  Book · Session · Blackboard · Snapshots    │
│  Artifacts · RuntimeEvent history           │
│  文件资源（books/…）；向量检索可插拔           │
└─────────────────────────────────────────────┘
```

合成边界：

> Book/规格描述可以运行什么，Session/快照保存实际发生了什么，相位机决定谁可动，编排器决定下一步 invoke 谁，Context Compiler 决定执行单元看见什么，Runtime 决定哪些修改正式生效。技能包是可装载能力，不是系统固定流水线。

---

## 5. 系统核心模块

### 5.1 规格与 Book（Definition 侧）

- Book：长期项目容器（过程、资产、游玩状态）
- `设计.worker集` accept 后 → 本实例 Worker 声明
- `instance` / `opening` 快照：规格与可选开局截面
- 导入导出、复制、从截面新开 play 线

细节：`book-storage.md`、`run-snapshot.md`。

### 5.2 Session 与 Instance Manager（运行侧）

- 按规格创建 / 加载 Session
- 自动续作 `session.json` 与手动 `run-snapshots/`
- 消息 swipe / branch checkpoint
- 从 earlier 快照恢复后重 roll

### 5.3 Main Agent（Supervisor）

接收压缩后的任务视图（目标、相位、可调用能力、最近产物摘要等），经 tool loop 输出调度意图；Runtime 校验后执行。

### 5.4 Phase Runtime（Dynamic Scheduler 的具体形态）

执行编排器决定并维护相位边界：

1. 校验 Worker id ∈ 声明
2. 编译上下文
3. 短生命周期执行 Worker
4. 收集写入请求 → 校验 / 合并 / 提交
5. 按 acceptance 可能进入 `waiting_user`
6. 预算：`maxBurst`；后续补齐嵌套深度、重复任务检测、Token/调用预算

实现：`src/runtime/phase-machine.ts`、`phase-runtime.ts`。

### 5.5 Worker

按任务实例化的短生命周期调用。保留的是事件、产物与状态修改，不是 Agent 对象。

### 5.6 Skill Registry

架构层两种能力层级：

- **包 / Orchestrator manifest**：能力发现、验收与进 play 门槛
- **Worker 契约**：声明驱动的输入输出、上下文段、工具边界

注册、加载、版本与磁盘格式见 Skill 系列文档；**具体工作流计划步骤不在本文**。

### 5.7 Context Compiler

确定性模块：按任务、Worker 权限与实例状态构建 Context View。

当前实现：`inputTags` / `contextSegments` + `assembleWorkerContext()`（`context-assembly.md`）。

演进契约：

- **Context Trace**：记录装载了什么、来源、权限依据、因预算/权限排除了什么
- 逻辑分区语义（public / narrative / characters / tables / artifacts / runtime）可映射到 tag 与可见范围；实现仍以 tag 黑板为主

### 5.8 Blackboard

带类型与来源的运行状态（tag 条目），不是全体 Agent 共享的大字符串。表字段使用 `value + rev + source`；正式写入经 Runtime。见 `tag-blackboard.md`。

### 5.9 Artifact 与验收

较长或需反复编辑的内容以黑板 tag / 产物记录保存；`drafted → under_review → accepted|rejected|revision_requested`；accepted 前不得当下游事实。

### 5.10 Commit and Validation

Worker 不直接改「当前事实」。路径：输出 → 声明/schema 校验 → 权限与 rev 合并 → 提交事件 → 更新黑板。结构化状态用受控写入；正文类产物仍记录来源与版本。

---

## 6. 数据持久化

当前以**状态快照为主**，会话内保留 `RuntimeEvent` history；完整领域事件溯源（投影 + 事件日志 + 周期快照）按分支/迁移/审计痛点再加深。

| 需求 | 机制 |
|------|------|
| 续作 | `session.json` |
| 规格截面 | `instance` / `opening` 快照 |
| 游玩存档 / 重 roll | `run` 快照；load = 恢复到该档 |
| 同开局多线 | 保留 opening/instance 层，清空或分支 run 层 |
| 调试回放 | `RuntimeSession.history` |

分支不要求复制整库；记录父档 / 基准快照即可。

---

## 7. 信息隔离

隔离由 Runtime 强制：Worker 只看到契约允许的 tag / 段。多角色模拟时，角色 Worker 不得看到他角私有记忆、未公开事件、编排器隐藏调度信息。

Context Trace 是排查泄漏的主工具（契约已定，实现渐进）。

---

## 8. 技术栈（现状与边界）

| 层 | 现状 | 边界 |
|----|------|------|
| 语言 | TypeScript / Node.js | — |
| Agent Runtime | 自研（main-agent、phase-runtime、llm） | 领域对象不绑定外部 Agent 框架内部类型；Mastra 等仅可作按层参考或远期适配 |
| 前端 | `web/` + Electron | 不强制 Next.js / assistant-ui；可借鉴交互模式 |
| 存储 | 文件系统 Book JSON | SQLite/Drizzle 非近端前提 |
| Skill | `skills/` + registry | 包内工作流计划与系统内核分离 |

外部仓库按模块借鉴，见 `references.md`；许可证见仓库根 `THIRD_PARTY_NOTICES.md`。

---

## 9. 术语对照

| 规划用语（抽象） | 本仓库用语（实现） |
|------------------|-------------------|
| CreationDefinition / DefinitionVersion / 运行规格 | `设计.worker集` 截面；`instance` / `opening` 快照 |
| RunInstance / 运行实例 | Book + Session + 黑板 + `run` 快照 |
| Recipe / 配方 | `recipes/`（UI 选一层）；黑板 `创作.选用配方` |
| Orchestrator / 编排器 | Main Agent（tool loop）+ `orchestrator.md` manifest |
| Workflow Plan / 工作流计划 | `设计.创作流程`（增量 DAG；非死板选单） |
| Skill / 技能 | `modules/` 工序池 |
| Worker / 执行单元 | 一次 `run_worker` invoke |
| Dynamic Scheduler | Phase Machine + Phase Runtime |
| Worker Factory | `run_worker` → 声明校验 → executor |
| Context Compiler | `assembleWorkerContext` / contextSegments |
| Blackboard | tag 黑板（`BlackboardItem`） |
| Commit Layer / 人工审批 | 写入校验、表 rev 合并、acceptance |
| Skill Registry | `skills/` loader + orchestrator manifest |

用户可见中文口径（禁止裸露内部 id）见 `ui-glossary.md`。

| 词 | 含义 |
|----|------|
| **Worker 声明 / 运行规格** | accept 后的 `设计.worker集` |
| **worker / 执行单元** | 一次 `run_worker` invoke |
| **stage** | `design` → `play` → `done`（创作 → 游玩 → 已完成） |
| **phase** | `idle` \| `running` \| `waiting_user` \| `done` \| `error` |

---

## 10. 文档地图

| 层级 | 文档 |
|------|------|
| **系统架构（本文）** | `architecture.md` |
| 运行内核 | `runtime-state-machine.md`、`tool-contracts.md`、`context-assembly.md`、`tag-blackboard.md` |
| 持久化 | `book-storage.md`、`run-snapshot.md` |
| UI | `ui-design.md`、`ui-glossary.md` |
| 实现顺序 | `implementation-guide.md` |
| **产品体验路线** | **`px-roadmap.md`**（PX0–PX5 交付与 DoD） |
| **日常场景 → P0** | **`daily-use-p0.md`**（场景、功能表、P0 工作包） |
| 外部参考 | `references.md` |
| **工作流计划 / 创作方法（非系统架构）** | `design-orchestrator-guide.md`、`creation-playbook.md`、`world-simulator-modules.md` |
| **Skill 包格式（非系统架构）** | `skill-format.md`、`orchestrator-skill-format.md`、`worker-skill-format.md`、`skill-design-guide.md`、`preset-format.md` |
| **技能撰写交接** | `briefs/capability-authoring-brief.md` |

---

## 11. 在现有内核上补齐（路线）

已具备：相位机、Agent tool loop、Skill loader、design-flow/step（modules/recipes）、Worker 声明、上下文拼装、表 rev、Web UI、快照 API。

1. **PX0**：配方选择 UI；AIRP + 长文/爽文主路径；**存档/续作硬稳定**；工作流计划保持动态
2. **PX1–PX2**：创作/游玩体验（可抄 UI）；副作用与多 run 线
3. **PX3**：Context Trace、调度预算、规格钉版本、E2E
4. **PX4–PX5**：长文加深；隔离模拟 + 调试（新方法边界可用新配方）
5. SQLite / 框架适配仅当痛点单开，不插入 PX0 关键路径

权威表：[`px-roadmap.md`](./px-roadmap.md)。

---

## 12. 主要技术风险

| 风险 | 解决边界 |
|------|----------|
| 上下文污染 | 全部经 Context Compiler；补 Trace |
| 自然语言误改状态 | 结构化状态只走受校验写入 / Patch |
| 调度死循环 | burst、后续嵌套/重复/预算限制 |
| 规格更新污染旧档 | 实例钉规格截面；显式迁移 |
| 框架耦合 | 领域与持久化不保存外部 Agent 框架内部对象 |

---

## 13. 实现进度（摘要）

```text
✅ phase-machine、phase-runtime、skills loader
✅ design-flow / design-step + modules/recipes + Worker 声明校验
✅ 声明驱动 worker 执行 + acceptance
✅ 表字段格 rev 合并
✅ Book session / run-snapshots / message branch
✅ 配方选择 UI（新建作品）；instance/run 存档人话 kind
✅ 长文模板 outline / chapter-writer；引导覆盖爽文/分段
✅ 失败/revision/error 出口；黑板用户手改 API
🟡 Context Trace（有基础 trace UI；编译器装载检查未齐）
⬜ 规格版本发布与迁移协议
⬜ 调度嵌套 / 重复任务 / Token 预算补齐
🟡 边沿副作用（有 table-side-effects；完整可观测 fixture 未齐）
⬜ 标准 fixture E2E（双线黄金路径自动化）
```
