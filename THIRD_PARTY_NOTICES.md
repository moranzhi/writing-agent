# Third-Party Notices

本仓库以自研运行内核与文档为主。下列项目**仅作架构与实现参考**（见 [`docs/references.md`](docs/references.md)），默认**不**将它们的源码整仓纳入本仓库。

在实际引入 npm/依赖、复制示例代码、或嵌入前端素材之前，必须逐项确认：

- LICENSE 是否允许修改与再分发
- 是否要求保留版权声明
- 前端素材是否使用不同许可证
- 示例代码与主仓库许可证是否一致
- 模型 Provider 是否另有使用限制
- 角色卡等格式是事实标准还是含特定项目代码

## Reference projects (not vendored by default)

| Project | URL | Intended use in this repo |
|---------|-----|---------------------------|
| Mastra | https://github.com/mastra-ai/mastra | Reference only (agent/tool patterns); not the runtime kernel |
| assistant-ui | https://github.com/assistant-ui/assistant-ui | Optional UI pattern reference |
| LobeChat | https://github.com/lobehub/lobe-chat | Product/IA reference |
| SillyTavern | https://github.com/SillyTavern/SillyTavern | UX/concept reference for cards & lorebooks |
| LangGraph.js | https://github.com/langchain-ai/langgraphjs | Checkpoint / recovery ideas |
| AutoGen | https://github.com/microsoft/autogen | Multi-agent runtime ideas |
| Letta | https://github.com/letta-ai/letta | Memory / context window ideas |
| OpenHands | https://github.com/All-Hands-AI/OpenHands | Event stream / observability ideas |
| CopilotKit | https://github.com/CopilotKit/CopilotKit | Agent–UI connection ideas |

When a dependency is added to `package.json`, record its license here (or under `licenses/`) and keep versions pinned via the lockfile.

## Direct dependencies

See `package.json` / lockfile for runtime and dev dependencies and their respective licenses.
