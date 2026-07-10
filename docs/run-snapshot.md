# Book 快照

用户手动保存、多档位；与自动续作 `session.json` 分离。

## 两种 kind（更新语义）

| kind | 名称 | 何时存 | 存什么 |
|------|------|--------|--------|
| **`instance`** | 设计完成 / 资产截面 | design 完成或从 play 剥离设定 | **CardAsset 级** tag（角色卡.确认稿、世界蓝图…）；**不含**轮次、事件流 |
| **`run`** | 游玩存档 | play 任意时刻 | instance 层 + `运行.*`、轮次、变量、对话 |

```text
CardBook design 完成  → 可存 instance（导出角色卡 / 世界设定）
PlayBook 进行中       → 可存 run（第 N 轮续玩）
```

**instance** 不再表示「14 步 pipeline 填完」，而是 **agent declare ready 时的可复用资产截面**。详见 `book-storage.md`。

## 与三种存储需求

| 需求 | 用什么 |
|------|--------|
| 创建角色卡**过程** | CardBook `designTrace` + messages（快照不替代，须 Book 级） |
| 创建好的**卡** | CardAsset 或 `instance` 快照 |
| 游玩**过程** | PlayBook `playTrace` + `run` 快照 |

## 与自动续作

| | `session.json` | `run-snapshots/` |
|--|----------------|------------------|
| 触发 | 自动 | 用户手动 |
| 数量 | 每 Book 1 份 | 多档、可命名 |
| 打开作品 | 默认恢复 | 选档 **加载** |

## API

```text
GET    /api/books/:bookId/saves
POST   /api/books/:bookId/saves     { label, kind: "instance"|"run", note?, sessionId? }
POST   /api/books/:bookId/saves/:id/load
DELETE /api/books/:bookId/saves/:id
```

## 实现

```text
src/types/run-snapshot.ts
src/book/run-snapshot-store.ts
src/book/snapshot-filters.ts      instance 时剥离 运行.* 等
src/server/session-manager.ts
```

存储：`books/{bookId}/run-snapshots/{id}.json`
