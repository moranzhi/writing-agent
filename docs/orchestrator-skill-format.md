# 总管 Skill 格式（Orchestrator / Manifest）

> **文档层级：Skill 包 manifest 格式（非系统架构）。**  
> 总管与相位机边界见 [`architecture.md`](./architecture.md)、[`runtime-state-machine.md`](./runtime-state-machine.md)。

## 1. 定位

**orchestrator.md** = 本包的 **manifest**：注册有哪些 capability、如何验收、何时可进 play。  
**不**写逐步流水线剧本。  
**创作方法**见 **`design-orchestrator-guide.md`**（三大步、表、自检）。

```text
新建作品 → 默认包
  → design：design-intake → 设计.worker集 JSON（实例声明）
  → 用户验收 → 用户手动进 play
  → play：Agent 按 Worker 声明 invoke worker
```

| 谁决定 | 什么 |
|--------|------|
| **Agent** | 何时 invoke 哪个 worker id（tool loop） |
| **Manifest** | design worker 列表、验收策略、readiness |
| **Worker 集** | 本实例启哪些 worker、表、常驻上下文、副作用 |
| **templates** | design-intake 合并用的可选默认契约（非运行时权威） |

见 `architecture.md`、`creation-playbook.md`、`design-orchestrator-guide.md`。

---

## 2. 存储位置

```text
skills/dialogue/world-simulator/
├── orchestrator.md
├── shared-context.md          # 可选
├── worker-templates/          # 可选 ref 模板（design 缺省）
└── workers/
    └── design-intake/SKILL.md
```

- 文件固定名 **`orchestrator.md`**。
- `registry.yaml` 的 `path` 指向它。

---

## 3. Frontmatter

```yaml
---
name: world-simulator
description: >
  默认能力库：Worker 集即实例声明…
category: dialogue
bookKind: dialogue
workers:
  - design-intake
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
## 总管优先行为
## 禁用行为
```

**不应包含：** 「第 N 步必须跑某 worker」管道剧本。  
方法细节指向 `design-orchestrator-guide.md`，勿在 manifest 重复长文。

---

## 5. Skill 注册表

### Design

| id | 说明 |
|----|------|
| design-intake | 产出 设计.worker集 JSON |
| （可选）开局赋初值 | 创作末尾可选，非每轮 |

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
| design-intake | true | user_confirmed |

play：**无**每轮强制验收；用户新输入 = 认可上轮终稿；重 roll 替代 reject。

---

## 8. 与 Worker 声明的关系

```text
accept 设计.worker集 → Runtime 构建 InstanceWorkerDeclaration
play：仅允许声明内 activeWorkerIds
表维护 / 副作用按规格边沿触发（见 design-orchestrator-guide §5）
```
