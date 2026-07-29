# 外部项目参考（按层借鉴）

以下仓库用于架构与实现参考。**只借鉴标明的一层，不把外部项目整体耦合进本仓库实现。**

本系统运行内核为自研（相位机 + tool loop + 声明驱动 Worker）。Mastra、Next.js、assistant-ui 等**不是**近端迁移目标；若引入，须经适配层，且领域对象不得保存框架内部类型。

许可证与再分发注意见仓库根 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

---

## 参考原则

1. 按模块读代码与文档，禁止整仓复制粘贴为业务内核。
2. 借鉴交互/产品概念时，数据模型仍用本仓库 Book / Session / 黑板。
3. Prompt 拼接、权限、上下文编译由本仓库 Context Compiler 实现，不照搬他站拼接逻辑。
4. 依赖使用 lockfile 精确版本；对外部项目的修改放在适配层。

---

## 仓库与借鉴层

### Mastra

- 仓库：<https://github.com/mastra-ai/mastra>
- **可借鉴**：Agent/Tool 声明方式、模型 Provider、结构化输出、Memory/Storage 接口形态、Workflow 适用边界、Observability、TypeScript 组织
- **不借鉴为内核**：不把动态调度、上下文权限、Definition/Instance、事件存档交给 Mastra 领域模型；本仓库已有 phase-runtime

### assistant-ui

- 仓库：<https://github.com/assistant-ui/assistant-ui>
- **可借鉴**：流式聊天、消息组件、Tool 调用展示、会话状态、人工确认、前后端连接方式
- **不负责**：Definition、存档、多 Agent 调度模型（仍由本仓库 API + Runtime）

### LobeChat

- 仓库：<https://github.com/lobehub/lobe-chat>
- **可借鉴**：本地 AI 应用信息架构、会话列表、模型配置 UI、助手/角色配置、插件与知识库管理体验、布局
- **不直接采用**：其会话数据模型

### SillyTavern

- 仓库：<https://github.com/SillyTavern/SillyTavern>
- **可借鉴**：角色卡产品概念、世界书编辑体验、聊天存档与分支心流、角色扮演工作方式、导入导出与兼容性概念
- **不照搬**：Prompt 拼接逻辑；世界书检索与权限由 Context Compiler 实现

### LangGraph.js

- 仓库：<https://github.com/langchain-ai/langgraphjs>
- **可借鉴**：有状态 Runtime、Checkpoint、中断与恢复、Human-in-the-loop、长时间任务可恢复执行
- **不采用**：用固定 Graph 表达整场创作流程（本仓库用相位机 + 动态 tool loop）

### AutoGen

- 仓库：<https://github.com/microsoft/autogen>
- **可借鉴**：多 Agent 消息与生命周期、Agent 选择、事件驱动运行、Tool 执行边界、Runtime 抽象
- **不采用**：Agent 间自由转发消息作为权限模型；上下文不得依赖自由转发

### Letta

- 仓库：<https://github.com/letta-ai/letta>
- **可借鉴**：长期记忆分层、上下文窗口管理、状态与消息历史区分
- **仍需自建**：小说、世界书、角色私有状态等领域模型

### OpenHands

- 仓库：<https://github.com/All-Hands-AI/OpenHands>
- **可借鉴**：运行会话、事件流、Action/Observation、前后端状态同步、暂停恢复与可观测性
- **不参考**：软件工程沙箱任务模型

### CopilotKit

- 仓库：<https://github.com/CopilotKit/CopilotKit>
- **可借鉴**：Agent 与前端状态连接、流式事件、Human-in-the-loop、生成式 UI、动态表与确认交互呈现
- **不替代**：本仓库 Book/黑板领域模型

---

## 与本仓库模块的映射

| 本仓库模块 | 主要可参考项目 |
|------------|----------------|
| Runtime / 调度 / 恢复 | LangGraph.js、AutoGen、OpenHands、Mastra（边界） |
| 上下文与记忆 | Letta、Mastra Memory 接口形态 |
| 聊天与 HITL UI | assistant-ui、CopilotKit、LobeChat |
| 角色卡 / 世界书 / 存档体验 | SillyTavern、LobeChat |
| 模型接入与可观测 | Mastra |

系统架构总览见 [`architecture.md`](./architecture.md)。
