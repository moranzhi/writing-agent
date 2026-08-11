# 具体实例

> 技能文档。程序只切割下方 **fence 块**；`##` 标题仅供人读。  
> 产物外壳：`docs/context-fragment-design.md`。  
> 本步极简：严格按已验收的「生成规则」执行，交出实际产物。

## meta

```meta
name: 具体实例
id: concrete-instances
artifact: 设计.具体实例
declaration: >
  按一条预生成规则原样产出实际产物（单层 JSON records）；可按 rule_id/批次反复调用；
  本步不设计、不改合同
when: |
  「设计.生成规则」中已有 `seed_only` 或 `seed_and_runtime` 的规则，需要生成实际内容。
when_not: |
  `runtime_only` → 游玩期再生成。
  无规则 / 规则不完整 / 想改格式或方法 → 回「生成规则」。
boundary: |
  本技能只做一件事：按指定规则生成 records。规则说怎么写、什么格式、如何用池，就照做。
  生成规则：合同制定方——本步不重论证、不修改。
feeds: gm
```

## opening

```opening
规则已由【本步参数】rule_id 钉死。有批次目标或数量偏好可一句带过；否则直接「按规则生成」。
```

## task

```task
你正在执行「具体实例」。产物必须是 **context-fragment.v1** JSON，写入「设计.具体实例」。

本步 = 规则执行器。禁止重议对象族、生命周期、schema 或描写方法。

执行顺序：
1. 取出 `params.rule_id` 对应规则；非预生成生命周期或缺信息 → 停止并指出缺口。
2. 数量：`params.count` 有数字用数字，否则用规则「数量」；`batch_goal` 只作不违反规则的筛选。
3. 完全按规则的「生成与描写」+「产物格式」+「池」生成 `records`（单层 JSON；键=schema 顶层字段）。
4. 按规则自检；不合格内部重做。已有产物则追加批次（除非用户要求替换）。
5. 输出 JSON；追问通常 `[]`。

summary：`具体实例 · {对象} · {n}条`
```

## principles

```principles
1. 只按规则来：方法、格式、池、数量、约束——规则有什么用什么；没有的不发明。
2. 只交 records：单层 JSON；不交解释、草稿、schema 副本、整池粘贴。
3. 要改合同 → 回「生成规则」，本步不加字段、不改枚举。
```

## probe

```probe
通常不追问。仅当 contextual 数量算不出时问一句规模依据。
用户要 schema 外内容 → 提示回「生成规则」。
```

## output

```output
{
  "schema": "context-fragment.v1",
  "技能": "具体实例",
  "brief": "rule_id + 本批条数",
  "mount": ["world-simulator"],
  "稳变": "stable",
  "正文": {
    "rule_id": "与 params 一致",
    "本批数量": 3,
    "批次条件": ["params.batch_goal 等；无则 []"],
    "batch_id": "英文 kebab-case",
    "records": [
      {
        "键来自规则产物格式 schema": "值"
      }
    ],
    "增量说明": "新建|追加|替换某 batch_id"
  },
  "自评": {
    "维度": [
      {
        "名": "合规模",
        "分数": 8,
        "说明": "是否严格按该规则的方法、单层格式、池与约束生成"
      }
    ],
    "薄弱点": "一句话；无则空字符串"
  },
  "追问": {
    "导语": "",
    "题目": []
  },
  "开放问题": []
}
```

硬规则：
1. 合法 JSON；含 `schema` / `技能` / `brief` / `正文` / `自评` / `追问`。
2. 正文键固定：`rule_id` / `本批数量` / `批次条件` / `batch_id` / `records` / `增量说明`。
3. `records` 每条必须是规则约定的单层 JSON；`本批数量 === records.length`。
4. 自评仅「合规模」一维。禁止改规则、写 `order`、输出执行单元列表。
5. summary：`具体实例 · {对象} · {n}条`。

## checklist

```checklist
- [ ] 按 params.rule_id 的预生成规则执行？
- [ ] records 单层、键值符合产物格式与全部约束？
- [ ] 自评为合规模？未改合同？
```

## examples

```examples
好：规则要 3 条怪物 → 交出 3 条单层 record，字段与池用法全服从规则。
坏：加规则没有的字段；输出一段「我是怎么想的」却没有 records；本步改 schema。
```
