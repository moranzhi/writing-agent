# 创作流程指南（Creation Playbook）

> **文档层级：工作流计划 / 创作流程概念（非系统架构）。**  
> 系统模块与边界见 [`architecture.md`](./architecture.md)。

## 0. 内容在哪

**设计方法（正推、三大步、表与副作用）** → **`design-orchestrator-guide.md`**（权威）。  
**流程落地**在 skill 包：`orchestrator.md` + `design-flow` / `design-step` + `modules/` / `recipes/`。  
写新包 → `skill-design-guide.md`（包格式薄层）→ `skills/.../orchestrator.md`；清单见 `world-simulator-modules.md`。

---

## 1. 定位

```text
Orchestrator 包     技能库 + manifest（静态）
黑板 tag            一次 Session 的实参（动态）
Book                跨 Session：过程、资产、游玩
设计.worker集       运行规格（JSON；accept 后 = 执行单元声明）
```

| 层 | 管什么 |
|----|--------|
| **运行相位** | `idle` / `running` / `waiting_user` — 系统在等什么 |
| **业务 stage** | `design`（创作）→ `play`（游玩）→ `done` |
| **编排器** | tool loop 内 invoke 哪个执行单元 |
| **运行规格** | play 可调度哪些 ref；executor 读声明（非题材管道） |
| **Book** | 长期存储，见 `book-storage.md` |

---

## 2. 默认包创作流

```text
新建作品 → UI 选配方 → 用户首句
  → design-flow：排出近期 设计.创作流程（工作流计划 / 增量 DAG，status=open|closed）
  → 反复 design-step：注入当前技能 modules/{id}/prompt.md + 依赖产物
  → 不够则再 design-flow（可追加 / 反复调用 repeatable 技能作**新建**）→ closed
  → 收成 设计.worker集（运行规格）→ 验收后才可进 play
  → 开场白与开场变量（若编排）：1～多条开场 → 选定 → 程序落库、关 DAG、保存 instance
  → （无开场白节点时可选）opening-generator 兜底落库
  → 用户手动进游玩
  → run：执行单元按契约从黑板重装；acceptance=review 处停、压缩过程 tag
```

固定上下文 tag 的主收益是 **跨执行单元复用同一份正文**；写下游时仍依赖上游定稿（不能只报 tag 名省掉正文）。能省的是扯皮过程（验收折叠）。

不再要求用户选择 skill 包；默认 orchestrator 见 `src/config/default-orchestrator.ts`。  
方法细节见 **`design-orchestrator-guide.md` §7.2**。不要以「回合推演 / 世界模拟」为默认总形态。

### 进入游玩

- Worker 集 **accepted**（试验期最低门槛）
- **进 play 由用户手动决定**；开局锁定非强制

### 编辑与重 roll

```text
关键节点可存快照
不满意 → 加载 earlier 快照 / 重 roll
play：重 roll 替代每轮验收；新输入 = 隐式认可上轮终稿
```

见 `run-snapshot.md`。

---

## 3. Agent 与 Runtime

| | Agent | Runtime |
|--|-------|---------|
| 决定 | invoke 哪个 worker、何时 ask_user/finish | — |
| 拼接上下文 | 只用 read_blackboard 辅助决策 | 常驻上下文 + 声明拼装 |
| 写黑板 | 否（边界 tool 驱动 worker 写） | 校验后写入；表字段尊重 rev |

Agent **不指定 inputTags**。见 `context-assembly.md`。

---

## 4. Tool loop burst

每次用户硬事件后，agent 进入 `running`，在 burst 上限内多轮 tool；碰到边界 tool 或需用户则停。  
见 `tool-contracts.md`、`runtime-state-machine.md`。

---

## 5. 相关

| 文档 | 关系 |
|------|------|
| **`design-orchestrator-guide.md`** | ★ 创作设计方法 |
| `skill-design-guide.md` | 包与字段格式 |
| `run-snapshot.md` | 存档 |
| `tag-blackboard.md` | 标签 |
