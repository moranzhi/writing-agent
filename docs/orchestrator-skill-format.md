# 编排器 Skill 格式（Orchestrator / Manifest）

> **文档层级：Skill 包 manifest 格式（非系统架构）。**  
> 编排器与相位机边界见 [`architecture.md`](./architecture.md)、[`runtime-state-machine.md`](./runtime-state-machine.md)。  
> **现行包落地**见 [`skills/dialogue/world-simulator/README.md`](../skills/dialogue/world-simulator/README.md)、[`world-simulator-modules.md`](./world-simulator-modules.md)。

## 1. 定位

**orchestrator.md** = 本包的 **manifest**：注册有哪些 design worker、如何验收、何时可进 play。  
**不**写逐步流水线工作流计划。  
**创作方法**见 **`design-orchestrator-guide.md`**（三大步、表、自检）。

```text
新建作品 → UI 选配方（recipes/）→ 默认包
  → design-flow → 设计.创作流程（工作流计划 / 近期步骤 DAG）
  → 反复 design-step（注入 modules/{id}/prompt.md）→ 收成 设计.worker集（运行规格）
  → 用户验收 → 用户手动进 play
  → play：编排器按运行规格 invoke 执行单元
```

| 谁决定 | 什么 |
|--------|------|
| **编排器** | 何时 invoke 哪个 worker id（tool loop） |
| **Manifest** | design worker 列表、验收策略、readiness |
| **运行规格** | 本实例启哪些执行单元、表、常驻上下文、副作用 |
| **templates** | design 缺省时合并用的可选默认契约（非运行时权威） |
| **recipes / modules** | 配方起点 / 技能工序正文 |

见 `architecture.md`、`creation-playbook.md`、`design-orchestrator-guide.md`。

---

## 2. 存储位置

```text
skills/dialogue/world-simulator/
├── orchestrator.md
├── recipes/                   # 配方选项
├── modules/                   # 技能 prompt 切片
├── worker-templates/          # 可选 ref 模板（design 缺省）
└── workers/
    ├── design-flow/SKILL.md
    ├── design-step/SKILL.md
    └── opening-generator/SKILL.md
```

- 文件固定名 **`orchestrator.md`**。
- `registry.yaml` 的 `path` 指向它。

旧名 `design-intake` / `design-core` 等 **已移除**；勿再写回磁盘。

---

## 3. Frontmatter

```yaml
---
name: world-simulator
description: >
  默认技能库：用户选配方 → 编排工作流计划 → 逐步执行技能…
category: dialogue
bookKind: dialogue
workers:
  - design-flow
  - design-step
  - opening-generator
demandTag: 用户.需求
startupMode: agent-first
uiPrompt: |
  …
---
```

---

## 4. Manifest 正文应有的节

```markdown
## Skill 注册表
## Instance Ready / 进入游玩
## 验收策略
## 编排器优先行为
## 禁用行为
```

**不应包含：** 「第 N 步必须跑某 worker」管道计划。  
方法细节指向 `design-orchestrator-guide.md`，勿在 manifest 重复长文。

---

## 5. Skill 注册表

### Design

| id | 说明 |
|----|------|
| design-flow | 编排近期 `设计.创作流程`（增量 DAG） |
| design-step | 执行当前能力步；注入 `modules/{id}/prompt.md` |
| opening-generator | （可选）开场白，非每轮 |

### Play

不在 manifest 写死清单。Agent 只调度 **`设计.worker集` 声明内的 ref**。

---

## 6. Instance Ready

```markdown
当 `设计.worker集` 已 accepted；进 play 由用户手动决定。
```

---

## 7. 验收策略

| skill | requiresApproval | acceptanceMode |
|-------|------------------|----------------|
| design-flow | true | user_confirmed（流程骨架） |
| design-step | true | user_confirmed（能力产物） |
| opening-generator | true | user_confirmed |

play：**无**每轮强制验收；用户新输入 = 认可上轮终稿；重 roll 替代 reject。

---

## 8. 与 Worker 声明的关系

```text
accept 设计.worker集 → Runtime 构建 InstanceWorkerDeclaration
play：仅允许声明内 activeWorkerIds
表维护 / 副作用按规格边沿触发（见 design-orchestrator-guide §5）
```
