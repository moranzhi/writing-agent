---
name: basic
description: >-
  何时选用：最小演示流程。收集创作简报后生成大纲。
  适用于快速验证状态机与 worker 调度。
category: novel
bookKind: novel
version: 1
workers:
  - outline
---

# 基础小说创作（演示）

## 启动询问

**向用户展示：**

```text
你选择了「基础小说创作」。请简单告诉我：

1. 想写什么题材？（如科幻、悬疑）
2. 大概多长？（短篇 / 中篇 / 长篇）
3. 用人称？（第一 / 第三人称）

可以一次说完。
```

**必须收集：**

- 题材
- 篇幅
- 人称

**写入目标：** `book.brief`

**足够进入下一阶段当：** 题材 + 篇幅 + 人称 已明确。

---

## 产物说明

| 产出 | 黑板 tag（迁移期可用 key 名） |
|------|------|
| 创作简报 | book.brief（≈ instantiate） |
| 大纲 | outline.draft（≈ run 产出） |

流程：`book.brief` → `outline` → finish。brief 阶段 = **实例化**，见 `docs/tag-blackboard.md` §2。

---

## Worker 编排

| 条件 | worker | inputKeys | outputKeys | acceptanceMode |
|---|---|---|---|---|
| `book.brief` 已齐，`startupCompleted`，无 `outline.draft` | outline | book.brief | outline.draft | user_confirmed |
| `outline.draft` 已 accepted | — | — | finish | — |

---

## 询问策略

### 总管应先问

- brief 缺失时重复启动询问要点

### 交给 Worker 问

- 大纲阶段缺具体角色或场景要求

---

## 验收策略

| 阶段 | acceptanceMode |
|---|---|
| outline.draft | user_confirmed |

---

## 禁用行为

- **禁止**跳过 brief 直接调度 outline。
- **禁止**总管直接撰写 outline.draft 正文。
- **禁止**调度本包以外的 worker。
