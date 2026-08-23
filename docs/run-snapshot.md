# Book 快照

用户手动保存、多档位；与自动续作 `session.json` 分离。

**编辑 / 重 roll 的统一做法：恢复到之前的快照，再从该点继续。**  
创作（design）与运行（play）共用此语义。

```text
存快照 → 继续生成 → 不满意 → 加载 earlier 快照 → 重跑后续 worker / 重出展示
```

## 三种 kind（更新语义）

| kind | 名称 | 何时存 | 存什么 |
|------|------|--------|--------|
| **`instance`** | 创作定稿截面 | Worker 集 accept；**选定开场后自动存**（也可手动） | `设计.worker集`、静态设定 tag、`运行.初始变量`、`输出.开场白`；**不含**后续轮次、事件流 |
| **`opening`** | 开局锁定（可选单独存） | 创作末尾 swipe 选定开场后 | 与 instance 中开局部分相同；便于「同 Worker 集、换开局再开 play 线」 |
| **`run`** | 游玩存档 | play 任意时刻 | instance/opening 层 + `运行.*`、轮次、变量当前值、对话 |

```text
Worker 集 accept     → 可存 instance（规格截面）
可选开局赋初值       → 可存 instance / opening（非进 play 强制门槛）
play 任意时刻        → 可存 多条 run
改 Worker 集         → load 旧 instance 再改
改某轮输出           → load 该轮前的 run → 重 roll / 重跑
```

**instance** = **Worker 集（+ 可选开局截面）**。进 play 由用户手动决定。见 `book-storage.md`、`design-orchestrator-guide.md`。

### 同一开局 · 多条存档

```text
opening-generator 锁定 checkpoint  =  共用起点
  ├─ run 存档 A（第 5 轮）
  ├─ run 存档 B（第 12 轮，另一分支）
  └─ 「从同一开局新开一条线」= 清空 run 层、保留 opening/instance 层（见 session-manager startNewPlayLine）
```

多条 **run** 快照共享同一 **opening**（或含 opening 的 **instance**），无需为每条 play 线复制 Worker 集。

## Swipe 与快照

创作末尾 **开局** 产出时，可用 message **branch / swipe** 多版本对比（可选）。  
play 对终稿可用 **重 roll**；用户新输入 = 认可上轮终稿。见 `design-orchestrator-guide.md`。

## 与三种存储需求

| 需求 | 用什么 |
|------|--------|
| 创作过程 | Book `designTrace` + messages |
| 实例规格 + 锁定开局 | `instance` / `opening` 快照 |
| 游玩过程 | PlayBook `playTrace` + **`run` 快照（同一开局可多条）** |
| 改设定 / 重 roll | 加载对应 kind 的 earlier 快照 |

## 与自动续作

| | `session.json` | `run-snapshots/` |
|--|----------------|------------------|
| 触发 | 自动 | 用户手动（关键节点建议提示存档） |
| 数量 | 每 Book 1 份 | 多档、可命名 |
| 打开作品 | 默认恢复 | 选档 **加载** |
| 编辑 | — | **load = 恢复到该档状态** |

## API

```text
GET    /api/books/:bookId/saves
POST   /api/books/:bookId/saves     { label, kind: "instance"|"opening"|"run", note?, sessionId? }
POST   /api/books/:bookId/saves/:id/load
DELETE /api/books/:bookId/saves/:id
```

（`opening` kind 可在实现中与 `instance` 合并存储，文档层区分语义即可。）

## 实现

```text
src/types/run-snapshot.ts
src/book/run-snapshot-store.ts
src/book/snapshot-filters.ts
src/server/session-manager.ts
src/server/message-branch.ts          swipe / branch checkpoint
```

存储：`books/{bookId}/run-snapshots/{id}.json`

## 相关

| 文档 | 关系 |
|------|------|
| `skill-design-guide.md` §0.4 | Worker 集与快照 |
| `creation-playbook.md` | 创作流中的开局与存档 |
| `context-assembly.md` | 恢复后 worker prompt 仍含 preset + static + dynamic |
