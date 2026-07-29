# 运行阶段机

## 1. 定位

阶段机 = **并发与权限模型**：谁在场、哪些 tool 可用、何时必须等用户、产物何时算事实。

**不是** 流水线执行器；「下一步 invoke 哪个 skill」由 agent tool loop 决定。

```text
业务 stage（Book / Session）
  design（实例化）→ play（运行）→ done

运行相位（RuntimePhase）
  idle | running | waiting_user | done | error
```

---

## 2. 五个运行相位

```ts
type RuntimePhase = "idle" | "running" | "waiting_user" | "done" | "error";
```

| phase | 含义 |
|-------|------|
| `idle` | 会话已创建 |
| `running` | agent burst 或 worker 执行中 |
| `waiting_user` | 等用户（见 waitingReason） |
| `done` | 正常结束 |
| `error` | 不可恢复 |

---

## 3. waitingReason

```ts
type WaitingReason =
  | { kind: "skill_selection"; availableSkills: SkillIndexEntry[] }
  | { kind: "intake"; prompt: string }
  | { kind: "input"; message?: string }
  | { kind: "approve_step"; decisionId: string }
  | { kind: "review_artifact"; artifactId: string }
  | { kind: "worker_questions"; workerId: string; questions: string[] }
  | { kind: "revision"; instruction?: string };
```

---

## 4. 阶段机 vs tool

| 角色 | 说明 |
|------|------|
| **循环 tool** | 仅当 `running` 且无阻塞 worker；结果进 agent messages |
| **边界 tool** | 触发 phase / waitingReason 变化 |
| **用户 event** | 唯一 approve、accept；burst 计数归零 |
| **Worker** | `running` 且 `currentWorkerId`  set 时，总管暂停 |

目标态工具表见 `tool-contracts.md`。

---

## 5. Tool loop burst

```text
用户硬事件
  → toolLoopBurstCount = 0
  → phase = running（若适用）
  → agent while burst < maxBurst:
        循环 tool …
        边界 tool → 可能 waiting_user / 启动 worker
  → worker 完成 → 按 acceptanceMode 可能 waiting_user
```

`maxBurst`：**两次用户操作之间**的上限（默认 12）。

---

## 6. 典型转移（简化）

```text
idle → intake（session_started + initialSkill）
intake 完成 / confirm → running → agent burst
running → run_worker → approve_step 或 worker 执行
worker_completed → review_artifact（user_confirmed）
user_accepted → running → agent burst
finish → done
```

---

## 7. 会话结构

```ts
type RuntimeSession = {
  id: string;
  phase: RuntimePhase;
  waitingReason?: WaitingReason;
  currentWorkerId?: string;
  acceptanceMode?: AcceptanceMode;
  resumeContext?: ResumeContext;
  slots: Record<string, unknown>;
  artifacts: ArtifactRecord[];
  pendingDecision?: MainAgentDecision;
  history: RuntimeEvent[];
  // 目标：toolLoopBurstCount, lifecycleStage
};
```

---

## 8. 产物生命周期

```text
drafted → under_review → accepted | rejected | revision_requested
accepted 前不得当下游事实
```

---

## 9. 与编排表的关系

**已废弃为主流程：** orchestrator「思维链 / 逐步编排表」驱动步骤。  
orchestrator 改为 **skill 注册表 + 验收策略**；阶段机不解析「第几步」。

`semi_auto` / `pauseCheckpoint` 仍可作为可选策略，由 manifest 声明，第一版未实现。

---

## 10. 代码

`src/runtime/phase-machine.ts` — 纯函数 `applyEvent`  
`src/runtime/phase-runtime.ts` — Session IO、tool loop 入口

旧 11 态已合并为 5 phase + waitingReason。
