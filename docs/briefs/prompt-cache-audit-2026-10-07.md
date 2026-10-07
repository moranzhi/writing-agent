# 提示缓存核对：记账是否可信、首填为何仍≈0

> 状态：核对结论。承接 `docs/briefs/token-cost-report-2026-10-06.md` §1.5 / §4.P2。  
> 记录：2026-10-07。  
> 疑问：若 OpenRouter 上 DeepSeek 缓存能挂住，是否说明「首填几乎不吃缓存」是本地记账错了，或粘滞/TTL 才是主因？

## 1. 结论（先看这个）

1. **缓存记账可信。** 我们只是把 OpenRouter 的 `usage.prompt_tokens_details.cached_tokens`（及 DeepSeek 的 `prompt_cache_hit_tokens`）原样写入 `~/.writing-agent/stats`；不是自估、不是漏字段。
2. **「首填≈0、retry 高」是上游真值，不是漏记。** 同轮对照里，绝大多数是 fill 几乎无缓存、fill-retry 立刻上到八成上下。若解析坏了，两边应同假。
3. **DeepSeek 探测成功，不能推翻 Gemini 首填账。** 花销报告窗口主模型是 `google/gemini-3.*-flash`；DeepSeek 只证明「同 baseUrl + 同解析链路」在另一模型上能读到非零缓存。
4. **粘滞/`session_id` 不是当前主账缺口。** 同会话内 fill→retry 已能吃到缓存，说明粘到了同一上游且前缀可复用；贵在 **每一轮第一枪大前缀仍全价**，以及 **重试常态**。
5. **优化优先级不变：** 仍以 P0（fill 去工具循环、消灭 retry）为主；P2（跨 select/fill 稳定前缀）对 Gemini 有意义，但不是「先修记账」或「再抠 TTL」。

---

## 2. 记账链路（我们记了什么）

| 层 | 行为 |
|---|---|
| OpenRouter 响应 | `prompt_tokens` / `prompt_tokens_details.cached_tokens` / 可选 `cache_write_tokens` |
| `parseUsage`（`src/llm/client.ts`） | 读 `cached_tokens`；DeepSeek 另认 `prompt_cache_hit_tokens` |
| stats jsonl | `cachedTokens` / `cacheWriteTokens` 等落盘 |
| 报告命中率 | `cached / prompt`（按请求平均或合计） |

单元测试覆盖 OpenAI details、DeepSeek hit/miss、cache write。探测脚本与生产走同一 `complete` → `parseUsage`。

**原始对照（2026-10-07，Gemini 探测）：** 直接 `fetch` OpenRouter，两次固定大前缀请求的 `usage` 均为：

```json
"prompt_tokens_details": {
  "cached_tokens": 0,
  "cache_write_tokens": 0
}
```

落盘若记成 0，与上游一致。

---

## 3. 生产窗口再切一刀（缓存行为）

范围：`~/.writing-agent/stats` 中 2026-10-03、10-04、10-06、10-07 的 `dictate_agent`（与花销报告同一量级窗口，略含 10-07）。

| step | 请求 | 有缓存占比 | 均命中率 | 中位命中 |
|---|---:|---:|---:|---:|
| select | 79 | 1.3% | ~0.8% | 0% |
| **fill** | 79 | **1.3%** | **~0.5%** | **0%** |
| **fill-retry** | 83 | **84.3%** | **~71.9%** | **~85%** |
| reply | 30 | 0% | 0% | 0% |

同轮 `fill` + 至少一次 `fill-retry` 的配对约 **45**：

| 模式 | 对数 |
|---|---:|
| 首填≈0 且 retry 命中 >40% | **34** |
| 两者都≈0 | 11 |
| 首填命中 >20% | **0** |

样本：同轮 `fill` `cached=0`、随后 `fill-retry` `prompt≈90k / cached≈82k`（命中约 91%）。这只能解释为：**上游在 retry 上报了高缓存，我们照记。**

模型侧：窗口几乎全是 `google/gemini-3.7-flash` / `gemini-3.8-flash`；与花销报告一致。

---

## 4. 探测：DeepSeek vs Gemini（同 OpenRouter）

核对方式：固定大前缀连打 OpenRouter，读 `usage.prompt_tokens_details.cached_tokens`（脚本已删，结论仍有效）。

### 4.1 `deepseek-v4-pro`

| 调用 | prompt | cached | 命中 |
|---|---:|---:|---:|
| A#1 | 10602 | 7650 | 72.2% |
| A#2～A#4 | 10602 | 9743 | 91.9% |
| 等 60s 后 B#1～B#2 | 10602 | 9743 | 91.9% |

→ 隐式缓存可用；短间隔爬升；**约 1 分钟间隔未掉光**。说明「同 baseUrl + 粘滞 + 记账」这条链对 DeepSeek 成立。

### 4.2 `google/gemini-3.8-flash`

| 调用 | prompt | cached | 命中 |
|---|---:|---:|---:|
| A#1～A#3（间隔 5s） | ~12.7k～15k | **0** | **0%** |

原始 `usage` 同上，`cached_tokens=0` 且 `cache_write_tokens=0`。

→ **不是我们没记上**，是这次探测形态下上游就报 0。与生产里「仅当 fill 刚跑过、retry 几乎同前缀」才高频命中，并不矛盾：retry 复用的是**刚发过的整包 fill 前缀**；探测的「新会话 + 纯文本 system」未复现那种命中。

OpenRouter 文档对 Gemini 同时提到隐式缓存与 `cache_control` 显式断点；本仓库**未打** `cache_control`。生产 retry 仍能命中，说明至少部分 Gemini 路由在「极近、极同前缀」下会报 `cached_tokens>0`；**不能**因此假设跨 select→fill、或跨轮首填也会自动吃到折扣。

---

## 5. 对花销报告结论的修正与保留

| 命题 | 判定 |
|---|---|
| 首填缓存几乎失效 | **保留**（记账复核后仍成立） |
| 贵主要因为 fill 大前缀 ×（1+retry） | **保留** |
| 怀疑「其实有缓存但没记」 | **否定** |
| 怀疑「DeepSeek 能缓存 ⇒ 当前账单不该贵」 | **否定**（账单模型是 Gemini；且 DeepSeek≠本窗口主路径） |
| 怀疑「再抠 TTL / session 就能救首填」 | **弱化**：同会话 retry 已证明粘滞可用；缺口在 **select≠fill 前缀** 与 **每轮第一枪**，不是「完全没粘住」 |
| P2 共享稳定前缀 | **仍值得做**（对 Gemini 跨步命中），但收益次于 P0 去循环 |
| 换 DeepSeek 指望隐式缓存 | **可作实验**，质量/工具/价格需另验；不能单靠本次探测定案 |

相对花销直觉（未缓存=1、缓存≈0.25）：retry 已打折，**未打折的是几乎每次的首填大包**。消灭 retry 或把首填变小，都比「怀疑仪表」更贴账单。

---

## 6. 建议（本核对后的落地顺序）

与 `token-cost-report-2026-10-06.md` §5 对齐，本文件只钉缓存相关验收：

| 步 | 动作 | 验收 |
|---|---|---|
| A | **不改记账**；需要时用原始 `usage` 或 `/generation` 抽查 | 抽查与 jsonl `cachedTokens` 一致 |
| B | P0：fill 改为一次 structured，去掉写工具循环 | 每轮调用 p50→2；fill-retry 占比 &lt;10%（主收益） |
| C | P2：select/fill 共用不变字节前缀，易变块置尾 | 同会话第 2 轮起 **fill 首次** `cached/prompt` 明显上升（Gemini 目标仍可订 ≥40%，以实测为准） |
| D | 若坚持 Gemini 显式缓存 | 单独评估 OpenRouter `cache_control`；先小流量探测，再决定是否进主路径 |
| E | 可选：用 DeepSeek 等隐式缓存友好模型做同书对照周 | 比的是 **有效单价 × 质量**，不是单看 hit% |

**明确不做：** 为「修缓存」去动 `parseUsage` 估命中；用 `provider.order` 换 `session_id`；把探测脚本的 DeepSeek 命中率写进创作账单当成已省钱。

---

## 7. 一句话答复原疑问

> 缓存记录是正确的。DeepSeek 能挂缓存，只说明链路和仪表没坏；当前创作窗口里 Gemini **首填几乎不打折是上游如实返回**，retry 高命中反而证明记对了。钱仍主要花在「每轮第一枪大前缀 + 填写真的在重试」，优先去 Agent 循环，而不是先怀疑统计或死磕 TTL。
