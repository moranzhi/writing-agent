# Skill 包索引

总管 skill 以 `orchestrator.md` + `registry.yaml` 注册后才会出现在启动列表。  
本目录下 **仅有 README 的文件夹** 为规划占位，AI 不会加载。

## 业务 stage 通则

每个 skill 包内 orchestrator 应区分：

```text
instantiate（实例化）  启动询问 / setup worker → prerequisite tags；现 stageId 常叫 brief
run（运行）            生产 worker 流水线（write / review / outline …）
done                   finish → 确认稿归档 Book
```

详见 `docs/tag-blackboard.md` §2。

## 已启用

| 包 | 路径 | instantiate → run |
|---|---|---|
| basic | `novel/basic/` | `book.brief` → outline |
| weird-rules-short | `novel/weird-rules-short/` | `book.brief` → write-rules + 双 review |
| roleplay-game-theory | `dialogue/roleplay-game-theory/` | instantiate → world-engine + role-decide × N + present-round（多 AI 可选） |

## 规划中（TODO）

| 包 | 路径 | 说明 |
|---|---|---|
| quick-write | `novel/quick-write/` | 简易档：弱化 tag，全量 LLM |
| interactive-novel | `novel/interactive-novel/` | 长篇：多 tag instantiate + 多轮 run |
| novel-standard | `novel/novel-standard/` | 标准流水线（或与 interactive 合并） |
| scene-roleplay | `dialogue/scene-roleplay/` | 扮演：角色/世界 instantiate + 互动 run |
| world-simulator | `dialogue/world-simulator/` | 世界模拟器：Step1–14 实例化设计 + run（大工程，设计期） |

**已取消独立包：** `character-card-author` / `character-card-play` — 角色设定与互动并入 `scene-roleplay` 的 instantiate / run，跨 Session 复用走 Book。

占位目录 `dialogue/character-card-*` 仅保留说明，不注册。

标签命名规范等细节以后补 `docs/tag-vocabulary.md`（低优先级）。
