# Tool 合约

## 1. 定位

LLM 通过 **tool call** 表达意图；Runtime 校验后执行 tool 或转为 **RuntimeEvent** 改变 phase。

**真 tool loop**：循环 tool 的返回值 append 到 agent `messages[]`；边界 tool 结束 burst。  
不依赖「副作用列表」隐式推进（迁移方向，见 `architecture.md`）。

黑板与上下文：`tag-blackboard.md`、`context-assembly.md`。

---

## 2. 调用者

| 调用者 | 可用 tool | 禁止 |
|--------|-----------|------|
| 总管 Agent | 见 §3 | 改 phase 直接写黑板；传 inputTags；accept 产物 |
| Worker LLM | `ask_user`、`submit`（目标态） | 调度其他 skill；写未声明 tag |
| 用户 / CLI | submit_input、approve、reject、accept | — |
| Runtime | 发射 event、拼接上下文、执行 worker | — |

---

## 3. 总管 Tool

### 3.1 循环 tool（burst 内，不改 phase）

| name | 作用 |
|------|------|
| `read_blackboard` | `tags: string[]` 读正文 |
| `list_workers` | 当前包可调度 skill 列表 |
| `list_artifacts` | 产物状态 |

### 3.2 边界 tool（结束 burst）

| name | 行为 |
|------|------|
| `run_worker` | 执行 skill；`requiresApproval` → `approve_step` |
| `ask_user` | `waiting_user(input)`；`assessment` → 内容评价（主内容）；`questions` → 挂载询问卡（可 Skip） |
| `review_blackboard` | 向用户展示概况 → `input` |
| `finish` | `done` |

```ts
type RunWorkerParams = {
  workerId: string;
  reason: string;
  requiresApproval: boolean;
  roleId?: string;
};
```

Runtime 从 Worker Skill 读 `inputTags` / `outputTags`，总管 **不得传入**。

### 3.3 Tool loop burst

```text
计数器 toolLoopBurstCount 在每次用户硬事件时归零：
  user_submitted_input、user_confirmed_intake、user_approved_next_step、
  user_rejected_next_step、user_accepted_artifact、user_rejected_artifact、…

running 内每轮 LLM+tool 使 burst+1；超过 maxBurst（默认 12，可配置）→ 强制 waiting_user
```

**maxBurst = 两次用户操作之间的上限**，非 Session 累计。

代码：`src/main-agent/tool-loop.ts`、`src/runtime/tool-registry.ts`。

---

## 4. Worker Tool（目标态）

| name | 行为 |
|------|------|
| `ask_user` | 无产物 → `worker_questions`；有产物 → 仍 `worker_completed`，追问挂到 `review_artifact.questions`（可直接 Accept） |
| `submit` | 校验 tag ⊆ outputTags → 写黑板 → `worker_completed` |

Phase A 仍用 JSON `outputs` + `askUser`，语义等价。

---

## 5. 用户硬事件

| waitingReason | 用户动作 |
|---------------|----------|
| `skill_selection` | 选包（**legacy**，新作品不再进入） |
| `intake` / `input` | 输入 |
| `approve_step` | approve / reject |
| `review_artifact` | accept / reject；可选 `questions` 随 Accept 一并收起（表示无需再完善） |
| `worker_questions` | 作答 / Skip（无产物时的阻塞追问） |
| `revision` | 输入修改说明 |

---

## 6. 校验

```text
1. phase + waitingReason 允许该 actor
2. tool 参数 schema
3. workerId ∈ manifest 注册表
4. submit tag ⊆ outputTags
5. 总管不得带 inputTags
6. burst ≤ maxBurst
```

---

## 7. 代码对应

| 章节 | 文件 |
|------|------|
| 总管 tool loop | `src/main-agent/tool-loop.ts` |
| tool 定义 | `src/main-agent/tools.ts` |
| 解析/校验 | `src/runtime/tool-registry.ts` |
| worker | `src/worker/executor.ts` |
| 阶段机 | `src/runtime/phase-machine.ts` |

---

## 8. 已废弃

- 总管 JSON 一次性决策（保留 fallback 解析）
- `inputKeys` / `outputKeys`
- orchestrator 思维链逐步调度
- 以 `PhaseEffect.invoke_main_agent` 链为主的路径（迁向 burst 入口）
