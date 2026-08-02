# 上下文拼接

## 1. 定位

Worker / skill 执行时，Runtime 将黑板 tag 与固定体裁说明拼成 LLM prompt。  
**拼接规则在 skill 定义期定制；拼接执行由 Runtime 机械完成；agent 不临场改 inputTags。**

详见 `docs/worker-skill-format.md`（字段）、`docs/tag-blackboard.md`（标签原则）。

---

## 2. 上半固定、下半动态

每条 worker prompt 自上而下拼接（**一段式 stack，越稳定越靠上**）：

```text
┌─ Preset（会话 presetId）────────────────────────────┐
│  生成参数、prompt 条目（system / 文风片段等）       │
│  见 preset-format.md；与 skill 包正交               │
└────────────────────────────────────────────────────┘
┌─ 上半：固定上下文（Static）────────────────────────┐
│  shared-context.md（包级体裁约束）                  │
│  worker SKILL.md 正文（能力说明、自检）             │
│  contextSegments 中 tier=static 的 tag              │
│    例：角色卡.确认稿、世界.蓝图、设计.worker集 切片  │
│    （含 narrator 的 presentation，无单独美学纲领 tag）│
└────────────────────────────────────────────────────┘
┌─ 下半：动态上下文（Dynamic）────────────────────────┐
│  contextSegments 中 tier=dynamic 的 tag             │
│    例：运行.事件流、可见信息、用户.最新输入          │
│  按 policy 裁剪（tail_lines、tail_tokens、concat）   │
└────────────────────────────────────────────────────┘
```

原则：

```text
越稳定、越少改 → 越靠上（preset / static）
越增量、每轮变 → 越靠下（dynamic）
```

创作期若产出了 `context_order`（见 `context-fragment-design.md`）：

```text
按 inserts 扁平 order 顺序拼装（不再按 static/dynamic 重排）
「对话.历史」是排序表中的普通标签，按 projection 动态裁剪后插入
```

`order 0` 建议为槽位人设（`worker.persona`）。  
`tier` 仅缓存提示；权威顺序是投影排序表。

**不是** agent 在游玩时自由往 prompt 里插段落；agent 只决定 **invoke 哪个 skill**；该 skill 的契约决定看见什么。

---

## 3. 三分工

| 谁 | 管什么 | 何时定 |
|----|--------|--------|
| **Skill 定义**（`workers/*/SKILL.md`） | inputTags、contextSegments、tier、policy、隔离 | 写 skill 时 |
| **实例 manifest** | 启用哪些 run skill、`contextProfile` 选哪档 variant | 实例化时 agent 产出 |
| **Agent** | 何时 invoke 哪个 skill；可用 read_blackboard 辅助决策 | 运行中 |
| **Runtime** | `assembleWorkerContext()` 唯一拼接点 | 每次 invoke |

---

## 4. contextSegments（Worker Skill 字段）

在 `SKILL.md` frontmatter 声明（`inputTags` 仍保留，作为取数白名单）：

```yaml
contextSegments:
  - id: persona
    tier: static
    tags: ["角色卡.确认稿"]
    label: "## 角色设定"
  - id: world
    tier: static
    tags: ["世界.蓝图"]
    label: "## 世界"
  - id: history
    tier: dynamic
    tags: ["运行.事件流"]
    policy: tail_lines_80
  - id: turn
    tier: dynamic
    tags: ["可见信息", "用户.最新输入"]
    label: "## 本轮"
```

| 字段 | 含义 |
|------|------|
| `tier` | `static`（上半）或 `dynamic`（下半） |
| `tags` | 从黑板取的 pattern，须在 `inputTags` 内 |
| `label` | 拼进 prompt 的 Markdown 标题（可选） |
| `policy` | 动态段裁剪，见 §5 |

未声明 `contextSegments` 时，Runtime 回退：按 `inputTags` 顺序输出 JSON `inputs`。

有 `contextSegments` 时：按 static → dynamic 顺序拼 Markdown（含 `label` 标题）；实现见 `src/skills/context-segments.ts` → `assembleWorkerContext()`。

创作前情：`创作.已验收内容` 存各单位**最后一次验收**的内容切片，拼装时格式化为只读前情提要。

---

## 5. 动态段裁剪 policy

| policy | 行为 |
|--------|------|
| `latest` | 每 pattern 取最新一条（默认） |
| `concat` | 同 pattern 多条合并 |
| `tail_lines_N` | 事件流等取最后 N 行 |
| `tail_tokens_N` | 按估算 token 截断（预留） |

上下文过长时（**本节管 Run worker 拼装**；创作会话见 `design-orchestrator-guide.md` §7.2）：

1. 优先靠 policy 裁剪动态段  
2. **Run 验收后压缩**：过程 tag 归档，仅终产物 + `上下文.定稿摘要` 进入下一 worker（`compress-after-worker.ts`）  
3. 实例 manifest 可覆盖 variant（如 `historyPolicy: last_10_turns`）  
4. 长线再考虑显式 compress-history / RAG，禁止「完整历史喂一个 LLM 再筛给另一个」

**创作**不走本拼装栈：讨论放 session `messages`；单位验收后 **删交互、留产物**。Worker 执行仍始终按契约从黑板重装。

---

## 6. contextProfile（实例 manifest）

实例化阶段产出（写入 `设计.worker集` 或 Book manifest），agent **只选预置档位**，不列 tag：

```json
{
  "runSkills": ["world-simulator", "narrator"],
  "contextProfile": {
    "narrator": { "variant": "card_rp", "historyPolicy": "last_15_turns" },
    "world-simulator": { "variant": "light_rules" }
  }
}
```

`variant` 在 skill 包内预定义多组 `contextSegments` 覆盖或 policy 差异。  
例：`narrator` 的 `card_rp` 强制 static 含 `角色卡.确认稿`；`short_emotion_flow` 缩短 dynamic 历史。

---

## 7. 隔离

与 `inputTags` 正交，由 skill 声明 `contextIsolation`：

```yaml
contextIsolation: none | role_pov | blind_review
```

- `role_pov`：role-decide 等，Runtime 调用 `filterInputsForRolePerspective`  
- `blind_review`：review 不可见指定 tag（如 `核心.危险.隐藏`）

隔离在 **取数之后、拼接之前** 应用。

---

## 8. 与 agent tool loop 的边界

两套上下文 **不得混用**：

| | Agent tool loop `messages[]` | Worker prompt |
|--|------------------------------|---------------|
| 用途 | 总管推理、选 skill | 具体 skill 执行 |
| 内容 | tool 结果、read_blackboard | assembleWorkerContext 输出 |
| 增长 | 两次用户操作之间的 burst 内累积 | 每次 invoke 按契约重建 |

总管 `read_blackboard` **不注入** worker prompt；只帮助 agent 决定下一个 `run_worker`。

---

## 9. 拼接结果形态（目标）

```text
system:
  {shared-context}
  {worker SKILL body}
  {固定输出协议}

user:
  {按 segment 顺序格式化的 Markdown 或结构化块}
```

实现：`src/skills/context-segments.ts` → `assembleWorkerContext()`；由 `src/worker/executor.ts` 调用。

---

## 10. 设计 checklist

```text
□ 列出 static / dynamic 各需要哪些 tag
□ static 写入 contextSegments tier=static
□ dynamic 写入 tier=dynamic 并选 policy
□ inputTags 覆盖 segments 中全部 pattern
□ 画隔离表：谁不可见哪些 tag
□ 若有多游玩模式，在包内预置 contextProfile variant
□ 实例化 manifest 只选 variant，不临场改 tag 列表
```

---

## 11. 相关文档

| 文档 | 关系 |
|------|------|
| `worker-skill-format.md` | frontmatter 字段定义 |
| `skill-design-guide.md` | 如何倒推 tag 与 skill 能力 |
| `tag-blackboard.md` | 标签命名与黑板 |
| `tool-contracts.md` | agent 不得传 inputTags |
