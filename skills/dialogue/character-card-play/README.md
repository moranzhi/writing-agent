# character-card-play（已合并概念）

**不再作为独立 skill 包。**

角色卡游玩 = 同一 skill 在 **run 阶段** 的互动流水线：prerequisite tags（含 `角色卡.确认稿` 或 `角色.*.设定`）已在 instantiate 填好或从 Book 加载后，总管调度扮演 worker。

```text
instantiate   收集/加载角色与世界 tag
run           多轮互动、用户.控制模式、场景反馈
done          归档 Book
```

见 `docs/tag-blackboard.md` §2、`skills/dialogue/scene-roleplay/README.md`（规划）。
