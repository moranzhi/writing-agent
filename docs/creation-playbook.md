# 创作流程指南（Creation Playbook）

## 0. 内容在哪

**流程定义在 skill 包里**（orchestrator manifest + `workers/*/SKILL.md`）。本文只保留概念。

写新包 → `skill-design-guide.md` → 新建 `skills/.../orchestrator.md`。

---

## 1. 定位

```text
Orchestrator 包     能力库 + manifest（静态）
黑板 tag            一次 Session 的实参（动态）
Book                跨 Session：过程、资产、游玩
```

| 层 | 管什么 |
|----|--------|
| **运行相位** | `idle` / `running` / `waiting_user` — 系统在等什么 |
| **业务 stage** | `design`（实例化）→ `play`（运行）→ `done` |
| **Agent** | tool loop 内 invoke 哪个 skill |
| **Skill** | 读哪些 tag、写哪些 tag、上下文怎么拼 |
| **Book** | 长期存储，见 `book-storage.md` |

---

## 2. 启动

```text
skill_selection     选 orchestrator 包
intake              启动询问（最小信息）
design stage        agent 按需 invoke instantiate skill
declare ready       进入 play
play stage          用户输入 → agent burst → run skill
done                归档 Book
```

`startupCompleted` / `instanceReady`：agent 声明 + 程序校验「当前 run_skill清单 可运行」，非固定 prerequisite 打勾。

---

## 3. Agent 与 Runtime

| | Agent | Runtime |
|--|-------|---------|
| 决定 | invoke 哪个 skill、何时 ask_user/finish | — |
| 拼接上下文 | 只用 read_blackboard 辅助决策 | assembleWorkerContext |
| 写黑板 | 否（边界 tool 驱动 worker 写） | 校验 outputTags 后写入 |

Agent **不指定 inputTags**。见 `context-assembly.md`。

---

## 4. Tool loop burst

每次用户硬事件后，agent 进入 `running`，在 **burst 上限内** 多轮 tool；碰到边界 tool 或需用户则停。  
见 `tool-contracts.md`、`runtime-state-machine.md`。

---

## 5. 角色卡（一种 Book 形态）

```text
创建过程    designTrace + 对话 → CardBook（design）
创建结果    角色卡.确认稿 等 → CardAsset（可导入资产）
游玩过程    playTrace + runState → PlayBook
游玩存档    PlaySnapshot
```

不拆独立 author/play 包；见 `book-storage.md` §角色卡。

---

## 6. 相关文档

| 文档 | 关系 |
|------|------|
| `architecture.md` | 总览 |
| `skill-design-guide.md` | 设计方法 |
| `context-assembly.md` | 上下文拼接 |
| `tag-blackboard.md` | 标签 |
