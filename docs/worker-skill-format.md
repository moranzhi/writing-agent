# Worker Skill 格式

## 1. 定位

**Worker Skill** 服务 **Worker Agent**：规定 **读哪些 tag、写哪些 tag、怎么做** 本阶段产出。

Worker **从属于某一个总管 Skill 包**，不与其它 skill 共享。

```text
总管：run_worker(write-rules)
  → Runtime 读 workers/write-rules/SKILL.md 的 inputTags / outputTags
  → 从黑板取匹配条目 → Worker 执行 → 写回 outputTags
```

规格背景见 `docs/tag-blackboard.md`、`docs/context-assembly.md`。

---

## 2. 存储位置

```text
skills/novel/weird-rules-short/
├── orchestrator.md
└── workers/
    ├── write-rules/SKILL.md
    └── review-infer/SKILL.md
```

- 目录名 = 包内 **worker id**。
- 文件统一 **`SKILL.md`**。
- **没有** 全局共享 worker 目录。

---

## 3. Frontmatter

```yaml
---
id: write-rules
skill: weird-rules-short
name: 规则与解析创作
description: >-
  从 需求.核心要点 推演内部核心，产出规则与说明。
version: 1
inputTags:
  - "需求.核心要点"
  - "验收.读者视角.记录"
  - "验收.作者视角.记录"
  - "用户.修改说明"
outputTags:
  - "核心.危险.隐藏"
  - "规则.草稿"
  - "规则.说明.草稿"
inputMerge: latest
---
```

| 字段 | 用途 |
|------|------|
| `id` | 包内 skill id，与 manifest 注册表一致 |
| `skill` | 所属 orchestrator 包 name |
| `inputTags` | Runtime 从黑板取数的 tag（精确或 `前缀.*`） |
| `outputTags` | 允许写回的 tag；Runtime 校验 |
| `inputMerge` | 可选，`latest`（默认）或 `concat` |
| `contextSegments` | 可选，上下文拼接：上半 static、下半 dynamic（见 §3.1） |
| `contextIsolation` | 可选：`none` \| `role_pov` \| `blind_review` |

### 3.1 contextSegments（上下文拼接）

见 `docs/context-assembly.md`。示例：

```yaml
contextSegments:
  - id: brief
    tier: static
    tags: ["book.brief"]
    label: "## 创作需求"
  - id: history
    tier: dynamic
    tags: ["运行.事件流"]
    policy: tail_lines_80
  - id: turn
    tier: dynamic
    tags: ["可见信息", "用户.最新输入"]
    label: "## 本轮"
```

未声明时 Runtime 回退为 JSON `inputs`（当前实现）。

**review-infer 示例**（不得读隐藏核心）：

```yaml
inputTags:
  - "需求.核心要点"
  - "规则.草稿"
  - "规则.说明.草稿"
outputTags:
  - "验收.读者视角.记录"
```

**review-author 示例**（可读隐藏核心）：

```yaml
inputTags:
  - "需求.核心要点"
  - "核心.危险.隐藏"
  - "规则.草稿"
  - "规则.说明.草稿"
outputTags:
  - "验收.作者视角.记录"
```

---

## 4. 正文章节

```markdown
# 标题

## 角色与口吻
## 能力范围            # 能做什么 / 不能做什么
## 思维链与自检
## 上下文用法          # 各 inputTag 如何使用（不重复 frontmatter 列表）
## 输出格式            # 各 outputTag 的 content 格式
## 示例                # 可选
```

正文中用 **tag 名** 指代上下文，例如「读 `需求.核心要点`」而非旧 key `book.brief`。

### 评估类 Worker

总管 orchestrator 只写：`rules 确认后 → run review-infer`。

本 SKILL 写 **评估怎么做**、verdict 写入 `验收.*.记录` 的 JSON 形状等。

### 用户回合 worker（user-turn）

**用途：** 该环节 **完全由用户输入** 组成，LLM 不替用户选行动（21 点玩家、线下人类一方等）。

**与 role-decide 的区别：**

| | role-decide | user-turn |
|--|-------------|-----------|
| 决策 | LLM 产出 `.思考` + `.行动` | 用户经 ask_user 提供；worker **只**写 `.行动` |
| LLM | 需要 | 仅需展示/校验/格式化（可无生成模型） |

**frontmatter 示例：**

```yaml
id: user-turn
skill: blackjack-roleplay
name: 用户回合
description: 展示局面，收集用户合法行动，写入角色.用户.行动
inputTags:
  - "角色.用户.可见信息"
  - "场景.公开叙述"
outputTags:
  - "角色.用户.行动"
```

**SKILL 正文要点：**

```markdown
## 角色
你是 **用户操作的采集器**，不是玩家 AI。禁止替用户选择行动。

## 执行
1. 读可见信息与合法行动集
2. ask_user：简短展示局面 + 列出可选行动
3. 校验用户输入是否在合法集内；不合法则再问
4. 写 `角色.用户.行动`（行动选择 + 可选说话）

## 禁止
- 调用 LLM 模拟用户策略
- 写入 `.思考`（用户无内心 tag，或仅 UI 留空）
```

编排：总管在轮到用户时 `run_worker(user-turn)`；world-engine 与 role-decide **同一套** 读 `.行动` 规则。

---

## 5. 运行时输出协议

Worker LLM 返回 JSON（Phase A）；Phase B 改为 tool call。语义不变：

```json
{
  "outputs": {
    "规则.草稿": "...",
    "规则.说明.草稿": "..."
  },
  "summary": "50字以内摘要",
  "askUser": null
}
```

- `outputs` 的 key 必须是 **outputTags 中的 tag**（或与 tag 一一映射的别名，由 Runtime 归一化）。
- 缺信息时 `askUser` 提问，不臆造。

Runtime 写黑板：

```ts
{
  id: "...",
  tag: "规则.草稿",
  content: "...",
  source: "write-rules",
}
```

---

## 6. ask_user

任何 worker 可中途提问。Runtime 暂停并保存 `resumeContext`（workerId 等）；恢复时 **重新** 从 SKILL 读 inputTags，不依赖总管。

---

## 7. 命名原则

Worker id 按 **本包流程职责** 命名，包内唯一：

| 包 | worker id | 职责 |
|----|-----------|------|
| weird-rules-short | write-rules | 写规则 |
| weird-rules-short | review-infer | 读者视角验收 |
| novel-standard | outline | 大纲 |

不要设计全局共享 worker id。

---

## 8. 与代码的关系

| 文档 | 代码 |
|------|------|
| frontmatter inputTags / outputTags | `src/skills/loader.ts` → `ParsedWorkerSkill` |
| 运行时取数 | `src/worker/executor.ts` |
| 角色 worker 独立 LLM | `llmProfileId` / `llm-bindings.yaml` | `src/skills/worker-llm.ts` |

当前代码仍为旧 `inputKeys` / `outputKeys` 模型；迁移以 `tag-blackboard.md` 为准。

---

## 9. Worker 独立 LLM（可选，预留多 AI 博弈）

默认：worker 与会话 **同一 ApiProfile**（设置页当前选中的 profile）。

### 9.1 Worker SKILL frontmatter

```yaml
llmProfileId: "<profiles.json 中的 ApiProfile.id>"
```

省略 = 走 skill 包 `llm-bindings.yaml` 或会话默认。

### 9.2 Skill 包 llm-bindings.yaml

```yaml
defaultProfileId: null   # null = 会话默认

workers:
  world-engine: {}
  role-decide:
    byRole:
      A: "<profile-id-1>"
      B: "<profile-id-2>"
```

Runtime 解析顺序见 `src/skills/worker-llm.ts`。  
`role-decide` 按 `slots.世界.当前角色.id` 匹配 `byRole`。

### 9.3 设计意图

- 配置仍在 **profiles.json**（或 .env），不在 SKILL 里写密钥
- 同一 skill 可让不同角色用不同模型/API，实现真实多 agent 博弈
- 总管 LLM 不受 worker 绑定影响（始终会话默认）

---
