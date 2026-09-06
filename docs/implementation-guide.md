# 实现指南

## 1. 写代码的规则

```text
1. 先读文档，再写对应文件。
2. 一次只写一个文件（或一组强绑定的 types + 实现）。
3. 每写完一个文件，对照对应规格文档自检。
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
| 本文件 | `implementation-guide.md` | 写代码规则与文档地图 |
| **产品体验路线** | **`px-roadmap.md`** | PX0–PX5 交付、DoD、明确不做 |
| **日常 → P0** | **`daily-use-p0.md`** | 日常场景、功能映射、P0 详细工作包 |
| **剧本 / 方法（非系统架构）** | `design-orchestrator-guide.md` | 创作三大步、表/副作用、自检 |
| **剧本 / 方法（非系统架构）** | `creation-playbook.md` | 创作流程概念（指向指导） |
| **剧本 / 方法（非系统架构）** | `world-simulator-modules.md` | 编排器/能力清单与现行包布局 |
| **剧本 / 方法（非系统架构）** | `progressive-data-design.md` | 真值 / Data / Progressive |
| **剧本 / 方法（非系统架构）** | `context-fragment-design.md` | 上下文片段、固定槽、投影排序 |
| **剧本 / 方法（非系统架构）** | `play-presentation-shells.md` | 游玩呈现壳 |
| **剧本 / 方法（非系统架构）** | `play-dm-auditor.md` | 主世界层与旁观维护 |
| **Skill 格式（非系统架构）** | `orchestrator-skill-format.md` | manifest 写法（非编排表） |
| **Skill 格式（非系统架构）** | `worker-skill-format.md` | SKILL.md、contextSegments |
| **Skill 格式（非系统架构）** | `skill-format.md` | 包存储、registry |
| **Skill 格式（非系统架构）** | `skill-design-guide.md` | 包格式薄层 |
| **Skill 格式（非系统架构）** | `preset-format.md` | 预设导入 |
| **能力撰写** | `briefs/capability-authoring-brief.md` | 外部 AI 写 modules 交接 |

许可证占位：仓库根 `THIRD_PARTY_NOTICES.md`。

工作簿（非规格）：`briefs/prompt-revision-inventory.md`、`briefs/design-flow-prompt-review.md`、`briefs/artifact-card-coverage.md`。

现行唯一落地包：`skills/dialogue/world-simulator/`（见该包 README）。

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
