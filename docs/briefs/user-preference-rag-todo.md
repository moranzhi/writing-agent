# 用户偏好 RAG 库（待定）

> 状态：**未实现**。先记设计共识与未决项，尤其 RAG 插入点。

## 已对齐

### 写库（学习，不改游玩上下文）

- 累计对话轮次 ≥ **10**（可在设置中改）后，尝试从最近对话**总结**用户偏好。
- 弹出**审核卡**：通过 / 编辑后通过 / 合并到已有 / 跳过。
- 通过后才写入全局偏好库；支持**去重**与**更新已有条目**。
- 「随机插一条」= 往库里记候选，**不**修改当前轮 prompt。

### 读库（仅创建期）

- 根据用户输入 **Boss 直聘式**召回匹配条目（卡片点选）。
- 选中结果收成**本局固定上下文**（`resident_context` / 叙事指南合并），不在游玩期动态插入。

### 条目形状（草案）

- `id`, `title`, `kind`（style|taboo|tone|format|other）
- `keys[]`（检索用）, `content`, `mount[]`, `always_on?`
- `source`（manual|learned）, `status`（active|archived）

## 未决：RAG 怎么插

当前仓库**无 embedding / 向量检索**。需先定插入架构，再写代码。

| 选项 | 做法 | 优点 | 风险 |
|------|------|------|------|
| A. 关键词召回 | `keys` + 标题匹配用户输入 | 零依赖、快落地 | 召回弱 |
| B. 创建期 LLM 选条 | 把库摘要交给 design-flow 一步选 | 与现有编排一致 | token、不稳定 |
| C. 本地 embedding | 条目向量化 + 相似度 Top-K | 真 RAG | 新依赖、索引维护 |
| D. 混合 | always_on + 关键词粗筛 +（可选）embedding 精排 | 可渐进 | 实现稍复杂 |

**读库插入落点（创建期）候选：**

1. `设计.用户偏好.选用集` fragment → `refine` 合并进 `resident_context` / 叙事 `情境备用` / `绝对禁忌`
2. 仅 `resident_context[]`，不经过叙事指南
3. 新设计步「用户偏好」专产选用集

**写库触发落点候选：**

1. `session-manager` 回合末计数 + 调 summarize API
2. 独立 `PreferenceService` + `/api/preferences/*`
3. 审核 UI 挂在 `SessionView.preferenceReview`

## 建议实现顺序（定好 RAG 后再做）

1. 库 store + 手写样例条目
2. 设置项 `preferenceReviewEveryTurns`（默认 10）
3. 读库：关键词召回 + Boss 卡片 + 选用集 tag
4. `refine` 合并选用集 → 固定上下文
5. 写库：轮次触发 + 总结 + 审核 + 去重写回
6. （可选）embedding RAG

## 相关现有基建

- 常驻：`src/skills/resident-context.ts`，`设计.worker集.resident_context`
- 投影排序：`context-order` inserts
- 叙事写法档：`设计.叙事指南` → `情境备用`
- 设置：`src/config/settings.ts`
- 无游玩期上下文注入需求（与 `context-assembly.md` 一致）
