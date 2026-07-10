# Book 存储模型

## 1. 定位

Book = **长期项目容器**。Session = 一次打开的运行进程。黑板 = Session 内运行时 tag。

存储须同时满足：

```text
1. 保存「创建过程」（designTrace / playTrace）
2. 保存「创建结果」（可复用资产，如角色卡）
3. 保存「游玩过程」（对话、轮次、变量、存档点）
```

第一版约束：不存 API key；历史与当前分离；accepted 才升为「当前事实」。

---

## 2. 三种 Book 形态

| 形态 | 用途 | 典型 kind |
|------|------|-----------|
| **CardBook** | 创作角色卡（design stage） | `character_card_design` |
| **CardAsset** | 从 CardBook 导出的可复用卡 | 资产条目，可挂卡库 |
| **PlayBook** | 用某张卡（+ 可选世界）游玩 | `character_card_play` / `roleplay` |
| **ProjectBook** | 小说等项目（沿用） | `novel` |

同一用户可：CardBook 创作 → 导出 CardAsset → 新建 PlayBook 引用该卡。

---

## 3. CardBook（创建角色卡）

### 3.1 存什么

```ts
type CardBook = {
  id: string;
  title: string;
  orchestratorId: string;
  lifecycleStage: "design" | "archived";

  /** 创作过程：可时间线展示、可续作设计 */
  designTrace: DesignTraceEntry[];

  /** 运行时黑板快照（设计.* tag） */
  designArtifacts: TaggedArtifact[];

  /** 用户可见对话；agent tool 对话可另存 agentTrace */
  messages: PersistedChatMessage[];

  runSkillManifest?: RunSkillManifest;  // 设计完成后：建议如何游玩
  readiness?: InstanceReadiness;

  createdAt: string;
  updatedAt: string;
};
```

```ts
type DesignTraceEntry = {
  at: string;
  type:
    | "user_input"
    | "agent_tool"
    | "skill_invoked"
    | "user_confirmed"
    | "user_rejected"
    | "declare_ready";
  skillId?: string;
  tool?: string;
  summary: string;
  outputTags?: string[];
};
```

**过程** = `designTrace` + `messages`（+ 可选 `agentTrace`）。  
**不是**预定实体槽填表；agent 调了哪些 instantiate skill，过程里就记哪些。

### 3.2 导出 CardAsset（创建结果）

```ts
type CardAsset = {
  id: string;
  cardBookId: string;
  title: string;
  tags: Record<string, string>;  // 角色卡.确认稿、角色.设定、口吻…
  runSkillManifest?: RunSkillManifest;
  confirmedAt: string;
};
```

游玩时 **加载 CardAsset**，不必重跑完整 design。

---

## 4. PlayBook（游玩角色卡 / 扮演）

```ts
type PlayBook = {
  id: string;
  title: string;
  orchestratorId: string;
  lifecycleStage: "play" | "archived";

  cardRef: { assetId: string; version?: string };
  worldRef?: { assetId?: string };

  contextProfile: ContextProfile;  // 实例化选的 variant
  runSkillManifest: RunSkillManifest;

  playTrace: PlayTraceEntry[];
  runState: {
    turn: number;
    variables: Record<string, unknown>;
    eventStream: string;
  };

  messages: PersistedChatMessage[];
  snapshotIds: string[];

  createdAt: string;
  updatedAt: string;
};
```

```ts
type PlayTraceEntry = {
  at: string;
  turn?: number;
  type: "user_input" | "skill_invoked" | "artifact" | "snapshot";
  skillId?: string;
  summary: string;
};
```

**游玩过程** = `playTrace` + `messages` + `runState`。  
**游玩存档** = `RunSnapshot`（kind=`run`），见 `run-snapshot.md`。

---

## 5. ProjectBook（小说等）

保留原 `BookProject` + `BookContentRecord` 思路：

```ts
type BookProject = {
  id: string;
  title: string;
  orchestratorId: string;
  kind: "novel" | "forum" | "weird_rules" | "custom";
  lifecycleStage: "design" | "play" | "done";
  currentContentId?: string;
  historyContentIds: string[];
  designTrace?: DesignTraceEntry[];
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

小说正文仍用 `BookContentRecord`（outline/chapter）；design 阶段 tag 可进 `designArtifacts`。

---

## 6. Session 与 Book

```text
Session（PersistedBookSession）
  当前打开的 working copy：RuntimeSession + 黑板 + messages
  关闭时可合并进 Book 的 trace / runState

Book
  稳定事实 + 过程记录 + 资产引用

沉淀规则
  design accepted tag  → CardBook.designArtifacts / 导出 CardAsset
  play accepted tag    → PlayBook.runState + 黑板归档
  draft / rejected     → trace 记一笔，默认不升 current
```

---

## 7. 与状态机

```text
worker_completed     → draft
user_accepted_artifact / no_confirmation / programmatic_pass
                     → 可写 Book（由 Runtime，非 agent 直接写）
```

---

## 8. 与黑板

| 阶段 | 黑板前缀示例 | 归档到 |
|------|--------------|--------|
| design | `设计.*`、`用户.需求` | CardBook / ProjectBook design |
| play | `运行.*`、`世界.*`、`输出.*` | PlayBook runState |

上下文拼接读黑板；Book 存 **确认稿与过程**，见 `context-assembly.md`。

---

## 9. 存储布局（建议）

```text
books/{bookId}/project.json
books/{bookId}/design-artifacts.json
books/{bookId}/traces.jsonl
books/{bookId}/contents/{contentId}.json   # 小说正文
assets/cards/{assetId}.json                # CardAsset 卡库
books/{bookId}/snapshots/{snapshotId}.json
sessions/{sessionId}.json                  # 可选 working copy
```

---

## 10. 实现优先级

```text
P0  文档对齐（本文）
P1  designTrace / playTrace 写入
P2  CardAsset 导出与 PlayBook.cardRef
P3  与现有 PersistedBookSession / RunSnapshot 字段合并
P4  卡库 UI、跨 Book 引用
```

代码现状：`src/types/book.ts`、`run-snapshot.ts` 仍为简化模型，实现时按本文扩展。

---

## 11. 角色卡流程示例

```text
1. 新建 CardBook → design stage
2. 用户与 agent 迭代 → designTrace 追加
3. invoke persona-* skills → 设计.* tag
4. 用户确认 → 导出 CardAsset
5. 新建 PlayBook，cardRef = assetId
6. play stage：每轮 playTrace + messages
7. 手动 PlaySnapshot 存档
8. 下次打开 PlayBook 或读 snapshot 续玩
```

创建过程、卡本身、游玩过程 **三者分开存**，互不覆盖。
