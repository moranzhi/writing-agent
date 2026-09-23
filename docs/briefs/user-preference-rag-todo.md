# 用户偏好库 / 文风库



> 状态：**节点绑定（无 RAG）**。偏好与文风分库；创作节点声明 `libraries` 后注入，库空跳过。



## 两库



| 库 | 存盘 | 绑定节点 | 注入 |

|----|------|----------|------|

| **文风库** `style-packs` | `~/.writing-agent/style-packs.json` | 叙事指南、叙事指南与故事推进 | 【文风库 · 可选用】 |

| **偏好库** `preferences` | `~/.writing-agent/preferences.json` | 用户需求 | 【偏好库 · 可选用】 |



## 读写



| 阶段 | 行为 |

|------|------|

| **库页** | 顶栏「库」：手写 CRUD + LLM 提取入库 |

| **创作节点** | design-step / 对话落盘按 `libraries` 注入目录；节点选用写入本局产物 |

| **开玩** | **不再**全量自动摊偏好；靠产物 `设计.用户需求` / `设计.叙事指南*` 挂载 |

| **游玩** | 每隔 N 回合采集偏好候选（设置项）；收下写入全局偏好库 |



## 偏好条目形状



- `id`, `content`, `status`（active|archived）, `createdAt`, `updatedAt`



## 文风包形状



- `id`, `name`, `content`, `samples?`, `status`, `createdAt`, `updatedAt`



## 设置



- `preferenceCollectEveryTurns`：采集间隔（默认 10；0=关）

- 设置页「用户偏好」：只留间隔；CRUD 在库页



## API



- `GET/POST /api/preferences`；`PUT/DELETE /api/preferences/:id`

- `POST /api/preferences/extract`

- `GET/POST /api/style-packs`；`PUT/DELETE /api/style-packs/:id`

- `POST /api/style-packs/extract`

- `POST /api/sessions/:id/preferences/review`



## 实现



- `src/libraries/registry.ts` — 库注册 + `formatBoundLibrariesForPrompt`

- `src/style-pack/` — 文风库

- `src/preference/` — 偏好库 + extract

- `skills/.../modules/user-requirements/` — 用户需求节点

- `web/libraries.html` — 库页


