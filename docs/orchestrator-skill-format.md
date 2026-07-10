# 总管 Skill 格式（Orchestrator / Manifest）

## 1. 定位

**orchestrator.md** = 本包的 **manifest**：注册有哪些 skill、如何验收、如何声明 instance ready。  
**不**写逐步流水线剧本；**不**写「总管思维链」逐步调度。

```text
用户选包
  → design：agent 按需 invoke instantiate skill
  → declare ready → play：agent invoke run skill
  → done：归档 Book
```

| 谁决定 | 什么 |
|--------|------|
| **Agent** | 何时 invoke 哪个 skill（tool loop） |
| **Manifest** | 可用 skill 列表、验收策略、readiness 规则 |
| **Worker SKILL.md** | inputTags、contextSegments、怎么做 |

`shared-context.md`：包级 **固定上下文上半**，注入各 worker prompt。总管不读。

见 `architecture.md`、`skill-design-guide.md`、`context-assembly.md`。

---

## 2. 存储位置

```text
skills/novel/weird-rules-short/
├── orchestrator.md
├── shared-context.md          # 可选
└── workers/
    └── write-rules/SKILL.md
```

- 文件固定名 **`orchestrator.md`**。
- `registry.yaml` 的 `path` 指向它。

---

## 3. Frontmatter

```yaml
---
name: weird-rules-short
description: >-
  何时选用：用户要写规则怪谈、守则类短篇。
category: novel
bookKind: novel
workers:
  - write-rules
  - review-infer
  - review-author
sharedContext: shared-context.md
---
```

| 字段 | 用途 |
|------|------|
| `description` | 何时选本包 |
| `workers` | run / design 可调度 skill id 白名单（loader 用） |
| `bookKind` | Book 存储形态 |

---

## 4. 正文章节（推荐）

```markdown
# 标题

## 启动询问              # 最小 intake
## Skill 注册表           # instantiate + run skill 清单与说明（见 §5）
## 验收策略               # 哪些 skill 产出需 user_confirmed / approve
## Instance Ready         # 按 run_skill清单 的动态最低可行性
## contextProfile         # 可选 variant 说明（见 context-assembly.md）
## 用户回合               # user-turn 等（可选）
## 禁用行为
```

**不应出现：**

- 逐步 **Worker 编排表** / **总管思维链**（已废弃为主流程）
- `inputTags` / `outputTags` 列表 → 在 `workers/*/SKILL.md`
- 写作细则 → Worker SKILL 正文

---

## 5. Skill 注册表（替代编排表）

列出本包 **能力库**，供 agent `list_workers` 与 manifest 校验：

```markdown
## Skill 注册表

### Instantiate（design stage）

| id | 说明 | 典型 outputTags |
|----|------|-----------------|
| interaction-paradigm | 定交互范式与 run_skill清单 | 设计.run_skill清单 |
| world-blueprint | 世界背景 | 设计.世界.蓝图 |
| persona-draft | 角色卡草稿 | 角色卡.草稿 |

### Run（play stage）

| id | 说明 | 默认 acceptance |
|----|------|-----------------|
| write-rules | 写规则 | user_confirmed |
| review-infer | 读者视角验收 | programmatic_review |
```

agent **按需 invoke**，不必按表顺序跑全。

---

## 6. 启动询问与 Instance Ready

**启动询问：** 只收集 agent 无法从空推断的最小信息 → `用户.需求` 等。

**Instance Ready：** 不写死「14 步全完成」，而写：

```markdown
## Instance Ready

当 `设计.run_skill清单` 已 accepted，且清单中每个 run skill 的
**最低 input 要求**（见各 SKILL.md）已在黑板存在或已记录跳过理由。
由 agent `declare_instance_ready` + Runtime 校验。
```

---

## 7. 验收策略

```markdown
## 验收策略

| skill | requiresApproval | acceptanceMode |
|-------|------------------|----------------|
| setup-scenario | true | user_confirmed |
| world-engine | false | no_confirmation |
| present-round | false | user_confirmed |
```

agent 通过 `run_worker(..., requiresApproval)` 触发；默认值也可写在 manifest 供 Runtime 填充。

---

## 8. contextProfile

若同一 skill 有多种游玩/创作模式，在 manifest 列出 variant 名与含义；实例化写入 Book。  
格式见 `context-assembly.md`。

---

## 9. 与 Worker SKILL 的关系

```text
orchestrator.md     注册 + 验收 + readiness
workers/*/SKILL.md  能力 + 上下文契约（contextSegments）
```

Prompt 注入：

```text
Agent：session 摘要 + tool；可用 read_blackboard
Worker：shared-context + SKILL + assembleWorkerContext（上固定下动态）
```

---

## 10. 迁移说明

旧包中的 `## Worker 编排`、`## 总管思维链` 仍可作为 **人工参考**，但新包与 world-simulator **不应**以此为主流程。  
Runtime 目标态以 agent tool loop + manifest 注册表为准。

---

## 11. 相关文档

| 文档 | 关系 |
|------|------|
| `skill-design-guide.md` | 设计方法 |
| `worker-skill-format.md` | SKILL.md 字段 |
| `creation-playbook.md` | 概念 |
