# Writing Agent

本地运行的多 Agent 文本创作与游玩平台：先为一部作品搭好可复用的运行规格，再进入游玩——你说一句，它按规格写一轮。适合交互式角色扮演、短局/长文、仿写扩写等场景。

数据默认落在本机用户目录（`~/.writing-agent`），通过浏览器或 Electron 桌面窗口使用；模型走你自己配置的 API。

## 它能做什么

- **创作**：为新作品选进料方式（工序编排 / 对话落盘（默认选项））与配方，由编排器调度技能，落成可复用的运行规格与开场
- **游玩**：在钉住的规格下回合推进；可切换呈现壳，保存游玩进度
- **技能包**：能力以磁盘上的技能包装载（当前主包为「世界模拟器」相关配方与模块）（目前不需要手动选择）
- **预设与库**：兼容 SillyTavern 风格的提示词预设；文风库 / 偏好库可注入创作节点，种子可从仓库恢复
- **多接口**：分组管理 API、嗅探型号、切换同一接口下的模型
- **本机优先**：Web（`localhost:23337`）或 `start-app.bat` 桌面壳；运维可用 `console.bat`

## 快速开始

1. 安装 [Node.js](https://nodejs.org/)（含 npm）
2. 双击 `start.bat`（桌面窗口则用 `start-app.bat`），浏览器打开 [http://localhost:23337](http://localhost:23337)
3. 在 **设置** 里新增模型接口（Base URL、API Key、型号）；根目录已有 `.env` 时可跳过
4. **新建作品** → 对话写出一张简单可玩卡 → **保存定稿** → 左侧菜单选 **游玩**

完整图文步骤（含截图与示例提示词）见 **[从启动到开玩](docs/guide/getting-started.md)**。

## 核心回路

```text
新建作品 → 选进料方式与配方
        → 创作（编排技能 / 对话落盘）→ 运行规格 + 开场
        → 保存定稿
        → 游玩（执行单元按规格上场）→ 保存游玩
```

术语以 `[docs/ui-glossary.md](docs/ui-glossary.md)` 为准（进料方式、配方、编排器、技能、运行规格、执行单元）。

## 仓库一览


| 路径                  | 用途                             |
| ------------------- | ------------------------------ |
| `src/`              | 运行时、会话、技能装载、Book/预设/库、HTTP API |
| `web/`              | 前端静态页                          |
| `skills/`           | 技能包（见 `skills/README.md`）      |
| `examples/presets/` | 示例预设                           |
| `seeds/libraries/`  | 文风/偏好库种子                       |
| `electron/`         | 桌面壳                            |
| `docs/`             | 架构与契约文档                        |
| `tests/`            | Vitest                         |


用户数据目录可用环境变量 `WRITING_AGENT_DATA_DIR` 覆盖；默认 `~/.writing-agent`（Windows 多为 `%USERPROFILE%\.writing-agent`）。

## 维护者

开发与排障常用命令：

```bash
npm install
npm run web          # 启动 HTTP 服务（不监视文件）
npm run web:watch    # 开发时监视 src/ 与 skills/
npm test             # Vitest
npm run libraries:restore   # 从 seeds 恢复库
npm run libraries:export    # 导出库到 seeds
```

Windows 运维脚本：`console.bat`（查询 / 启停 / 日志）。入口实现：`src/server/web-server.ts` → `session-manager.ts` → `src/runtime/` + `src/main-agent/` + `skills/`。

**安全注意**：本地 HTTP 控制面默认无鉴权，且会监听本机端口；请勿把服务暴露到不可信网络。API Key 以明文保存在用户数据目录的配置里。

### 文档索引


| 文档                                                              | 内容                   |
| --------------------------------------------------------------- | -------------------- |
| [architecture.md](docs/architecture.md)                         | 系统架构与模块边界            |
| [ui-glossary.md](docs/ui-glossary.md)                           | 用户可见术语               |
| [implementation-guide.md](docs/implementation-guide.md)         | 文档地图与实现约定            |
| [runtime-state-machine.md](docs/runtime-state-machine.md)       | 相位机                  |
| [tool-contracts.md](docs/tool-contracts.md)                     | Tool 契约              |
| [run-snapshot.md](docs/run-snapshot.md)                         | 存档 / 快照（以代码现状为准）     |
| [play-presentation-shells.md](docs/play-presentation-shells.md) | 游玩呈现壳                |
| [preset-format.md](docs/preset-format.md)                       | 预设格式                 |
| [skill-format.md](docs/skill-format.md) 等                       | 技能 / 编排器 / Worker 格式 |
| [px-roadmap.md](docs/px-roadmap.md)                             | 产品路线图                |
| [skills/README.md](skills/README.md)                            | 技能包目录说明              |


`docs/book-storage.md` 描述的是目标存储模型，**不是**当前磁盘布局；当前以 Book JSON + session + run-snapshots 为准。

## 许可与第三方

见 `[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)`。项目版本见 `package.json`（当前 `0.1.0`，`private`）。