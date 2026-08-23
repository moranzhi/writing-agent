# 创作产物 · 前端美化卡覆盖（快查）

> 随 `web/agent-ui.js` 的 `renderSpecialtyBodyHtml` / `renderKnownArtifactHtml` 维护。

| 产物/技能 | 美化程度 | 渲染入口 |
|-----------|----------|----------|
| 美学纲领与交互范式 | **左右分栏**：左契约（美学纲领+交互范式）/ 右诊断（设定逻辑） | `renderSpecialtyBodyHtml` → aesthetics |
| 实现机制 | **专用卡**（支撑点） | `renderMechanismBodyHtml` |
| 舞台骨架 | **专用卡** | `renderWorldBlueprintBodyHtml` |
| 生成规则 | **专用卡** | `renderGenerationRulesBodyHtml` |
| 具体实例 | 通用 fragment / 结构化 | context-fragment 外壳 |
| 叙事指南与故事推进 | **专用 mosaic**（风格与写法 \| 推进与决策） | `renderNarrativeBodyHtml` |
| 变量设计 | **结构化卡**（真值 / side_effects） | `renderVariableDesignHtml` |
| 变量控制上下文 | 通用 fragment | context-fragment |
| 正文组成 | **专用卡**：present 壳渲染 `正文.示例.灌数`（看美化）+ 契约折叠 | `renderReplyFormatBodyHtml` |
| 设计监控栏 | 通用 fragment | context-fragment |
| 游玩拓扑 | **槽位芯片卡** | `renderPlaySlotsHtml` |
| 上下文投影排序 | **排序卡** | `renderContextOrderHtml` |
| 裁决包 settlement.v1 | **分节卡** | `renderSettlementSectionsHtml` |
| 开场白与开场变量 | 专用：候选 swipe + 呈现壳 | `renderOpeningSetupBodyHtml` |
| 拓扑图谱 | （骨架未写） | — |

**说明：** 「通用 fragment」= 公共头（brief/mount/自评）+ 正文结构化树，已比生 JSON 友好；「专用」= 按技能排版的 mosaic/卡片。  
游玩美化面板另见 `docs/play-presentation-shells.md`（与创作验收卡不同层）。
