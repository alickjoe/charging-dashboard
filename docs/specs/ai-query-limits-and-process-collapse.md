# AI 查询：截断治理通用配置 + 结论优先的过程折叠

状态：已确认（2026-11-03；轮次默认值按用户要求设为 500）  
涉及：`backend/app/services/llm_agent_service.py`、`backend/app/sqlite_store.py`、`backend/app/schemas/llm.py`、`backend/app/routers/llm.py`、`frontend/src/pages/LLMConfigPage.tsx`、`frontend/src/pages/NLQueryPage.tsx`、`frontend/src/api/llm.ts`、i18n

---

## 1. 背景：为什么 AI 查询经常「输出不完整」

代码核查（2026-11-03，main@87b4ef1）后确认，以下 7 处都会让一次查询看起来「被截断」，其中 1、2、3 是最可能的主因：

| # | 位置 | 现状 | 对用户的影响 |
|---|---|---|---|
| 1 | `llm_agent_service.py:76` | `MAX_ROUNDS = 100` 硬编码，全仓无任何配置项 | 轮次到底用多少完全不可控；达到上限时强制收尾，吐出 `accumulated_content or "已执行最大轮数，分析结束。"`（`llm_agent_service.py:484-493`） |
| 2 | `llm_agent_service.py:47` | 系统提示词硬编码 `"8. Max 5 query rounds."`，与 `MAX_ROUNDS = 100` 自相矛盾 | 模型按 5 轮自我收口 → 分析中途主动总结，**这是「话说一半就结束」的头号嫌疑** |
| 3 | `llm_agent_service.py:303-311` + `llm_service.py:146` | `max_tokens` 只来自模型配置（`llm_configs.max_tokens`，默认 4096）；且 **`finish_reason` 从未被检查** | 输出被 `length` 截断时，半截内容会被当作最终 `done` 结论落库并展示，用户完全无法察觉 |
| 4 | `llm_agent_service.py:290` | `httpx.AsyncClient(timeout=120)` 硬编码 | 长查询 120s 被切断；`except httpx.ReadTimeout`（`:364`）只发一条「LLM 响应超时，已返回部分结果」后**没有 return**，部分内容继续冒充结论 |
| 5 | `llm_agent_service.py:452-462` | 结果行数硬编码 `rows[:100]`（SSE）/ `rows[:20]`（预览） | 大结果集在界面上「看起来缺数据」 |
| 6 | `llm_agent_service.py:79-164` | schema 摘要硬编码 `[:5]` 表 / `[:20]` 表 / `[:50]` 列 | 表很多时模型看不到目标表 → 猜错表 → 结论草率 |
| 7 | `llm_agent_service.py:281-288` | `messages` 只增不减，无上下文/token 预算 | 长会话后请求体膨胀，模型服务端可能直接报 context length 错误 |

结论：用户记忆中的「可以配置轮次的地方」**当前并不存在**（全仓 grep 无任何 rounds 配置项，UI 里也没有）。本次要把它补上，并且按用户要求做成**一份通用配置，跨模型、对所有 AI 查询生效**（不是每个模型单独配）。

---

## 2. 需求一：AI 配置页新增「通用设置」

### 2.1 配置项（单一全局作用域，对所有模型 / 所有查询生效）

| 字段 | 键 | 默认 | 范围 | 说明 / 替换的硬编码 |
|---|---|---|---|---|
| 工具调用轮次上限 | `max_rounds` | `500` | 1–2000 | 替换 `MAX_ROUNDS`；同时把系统提示词第 8 条改成引用该值 |
| 单轮输出 token 上限 | `max_tokens` | 空（= 用各模型配置） | 1–32768 | 空/NULL 表示沿用 `llm_configs.max_tokens`；填了就覆盖所有模型 |
| 单次请求超时（秒） | `request_timeout_sec` | `120` | 10–1800 | 替换 `httpx.AsyncClient(timeout=120)` |
| 单次 SQL 结果行数上限 | `max_result_rows` | `100` | 10–1000 | 替换 `rows[:100]` / `rows[:20]` |
| 截断自动续写次数 | `auto_continue_rounds` | `1` | 0–5 | `finish_reason == "length"` 时自动续写；0 = 不续写只提示 |
| 历史消息条数上限 | `max_history_messages` | `20` | 0–200 | 0 = 不限制；按「整条 tool-call 组」裁剪，避免拆散 tool_calls / tool 消息 |

不做成「每个模型一份」的理由：用户明确要求「可作为通用部分跨不同 ai 模型配置使用，针对所有 ai 查询生效」；这些是进程级行为参数，与具体 provider/model 无关。模型自身仍保留 `max_tokens`（充当兜底默认值）与 `temperature`。

### 2.2 存储

`config.db` 目前没有任何通用 settings 表，新增键值表（`sqlite_store.py` DDL 区，`llm_configs` 之后）：

```sql
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

新增 `SettingsStore`（与 `LLMConfigStore` 同一文件、同一风格）：

- `get_all(prefix: str | None = None) -> dict[str, str]`
- `get_many(keys) -> dict[str, str]`
- `upsert_many(mapping) -> None`（事务内 `INSERT ... ON CONFLICT(key) DO UPDATE`，刷新 `updated_at`）

缺省值只存在于 Python 侧 `backend/app/services/ai_query_settings.py`（`AI_QUERY_SETTINGS_DEFAULTS` + `load_ai_query_settings()` / `save_ai_query_settings()` 负责类型转换与边界 clamp），DB 里只存「用户改过的值」——这样以后调默认值能直接生效，也避免迁移。

### 2.3 接口（`backend/app/routers/llm.py`）

- `GET /api/v1/ai-query-settings` → `{"values": {...有效值}, "defaults": {...缺省值}}`
- `PUT /api/v1/ai-query-settings`，请求体为全字段可选（`AIQuerySettingsUpdate`），返回同 GET 结构

Schema 放 `backend/app/schemas/llm.py`：

```python
class AIQuerySettingsUpdate(BaseModel):
    max_rounds: int | None = Field(None, ge=1, le=2000)
    max_tokens: int | None = Field(None, ge=1, le=32768)  # 需能表达「清空」，故用显式 null + 单独字段
    request_timeout_sec: int | None = Field(None, ge=10, le=1800)
    max_result_rows: int | None = Field(None, ge=10, le=1000)
    auto_continue_rounds: int | None = Field(None, ge=0, le=5)
    max_history_messages: int | None = Field(None, ge=0, le=200)
```

注意 `max_tokens` 的「清空为沿用模型配置」语义：Pydantic 无法区分「未传」与「传 null」。用 `model_fields_set` 判断是否出现，出现且为 `None` 即删除该键。

### 2.4 后端接线（`llm_agent_service.py`）

- `run_agent_stream(..., settings: dict | None = None)`；`routers/llm.py` 在 `/api/v1/nl-query-stream` 里 `await load_ai_query_settings()` 后传入。缺省 `None` 时函数内部回落默认值（保证测试/单发调用不受影响）。
- 轮次：`for _round in range(settings["max_rounds"])`；提示词第 8 条改为
  `"8. You may use up to {max_rounds} tool-call rounds; run as few queries as possible and stop once the data answers the question."`
  （消除 5 vs 100 的矛盾，不再用「query rounds」误导模型）。
- token：`effective_max_tokens = settings["max_tokens"] or llm_config.get("max_tokens", 4096)`，同时作用于 `llm_agent_service` 与 `llm_service`（单发路径，如技能生成仍用自身常量）。
- 超时：`httpx.AsyncClient(timeout=settings["request_timeout_sec"], verify=False)`。
- 结果行数：SSE `result` 的 `rows[:max_result_rows]`；`result_preview` 沿用同一上限（完整行数仍通过 `total_rows` 告知前端）。
- **`finish_reason` 检测（关键修复）**：SSE 解析时记录最后一个 chunk 的 `choices[0].finish_reason`。
  - `"length"` 且还有 `auto_continue_rounds` 额度 → 把已生成内容作为 `assistant` 消息追加，再追加一条 `user` 续写指令（`[续写] 上次输出因 token 上限中断，请从断点继续，不要重复已输出内容。`）继续请求，不中断主循环；额度用尽仍为 `length` → 发非致命 `error` 块：
    `输出达到 token 上限被截断（已自动续写 {n} 次），结论可能不完整；可在「AI 配置 → 通用设置」中调大「单轮输出 token 上限」。`
  - 这样被截断的半截内容不会再冒充完整结论（对齐「LLM JSON 输出健壮化」里 finish_reason 的既有经验）。
- 超时分支（`:364`）补 `continue`/`break` 语义：已累计内容保留，但必须发一条明确的「已超时，结论不完整」error 块，禁止静默把部分结果当 done。
- 历史裁剪：`_trim_history(messages, max_history_messages)`，从尾部保留 N 条，再从头部推进到第一条 `role == "user"`，并丢掉孤立的 `tool` 消息（防止拆散 tool_calls 组导致 API 400）。

### 2.5 前端（`LLMConfigPage.tsx`）

页面顶部新增一张「AI 查询通用设置」卡片（在「新增模型」按钮下方、模型卡片列表上方）：

- 说明文案：`这些设置对所有模型、所有 AI 查询生效。`
- 6 个 `InputNumber`（`max_tokens` 允许留空，placeholder = `留空则使用各模型配置`），底部「保存」按钮 + 「恢复默认」按钮。
- 数据：`useQuery(['ai-query-settings'])`；保存走 `useMutation` → `updateAIQuerySettings`，成功后 `invalidateQueries(['ai-query-settings'])` + toast。
- API 层：`frontend/src/api/llm.ts` 增 `fetchAIQuerySettings()` / `updateAIQuerySettings(payload)`。
- 所有文案走 i18n：`llm.generalSettings.*`（zh/en 两份 json 同步）。

---

## 2.6 截断的第八类原因：工具调用标记被当成正文（2026-11-03 补）

实测（会话 29、消息 176）出现结论块内容为 `</tool invoke>` / `</functions>` —— 某些 DeepSeek 风格端点的 DSML 工具调用会被服务端当作普通文本放进 `content`，`tool_calls` 为空，于是「最后一轮没有工具调用」被判定为最终答案，把控制标记当结论落库。处理：

- `_strip_tool_markup()`：剥离 `<|…|>`、`</tool invoke>`、`</functions>`、`<function=…>` 一类控制标记后再判断是否为空。
- 若整轮内容只有标记：不落结论，回一次「[纠正] 上一条回复只有工具调用标记、没有实际内容……」再请求；仍失败则发 error（`模型本轮只返回了工具调用标记、没有生成结论`）+ `done.message=""`。
- 顺带修正 `llm_time_ms`：原来只上报最后一轮的耗时（44 步的回答显示 563ms），改为累计所有轮次。

---

## 2.7 模型退化：提示词回显与重复循环（2026-11-03 补）

实测（会话 29、消息 182）：一轮回答 121KB、耗时 153s，`raw_messages` 里的 assistant 内容 36KB，以 `</tool invoke></functions>` 开头后紧跟 `# 用户问题` 与**整段提示词回显**，中间夹杂大量 `<function name=...>` 工具 schema 文本、以及「好。执行。」式重复 400 次的退化循环，最后由 `finish_reason=length` → 自动续写 1 次 → 「输出达到 token 上限被截断」收尾。

原因是工具调用标记泄漏成正文后，模型看到自己上一轮的畸形输出，进入「回显提示词 / 无限重复」的退化模式。处理：

- `_detect_bad_round(content, question)`：识别 `markup_only` / `markup_prefix`（以控制标记开头）/ `prompt_echo`（包含用户问题前 40 字或 `## CRITICAL LANGUAGE REQUIREMENT`、`# 用户问题` 等标记）/ `repetition`（同一行占比 ≥30%，或短前缀重复 ≥20 次，覆盖无换行的连续复读）。
- 判定为坏轮时**丢弃该轮 assistant 消息**（避免污染下一轮上下文），回一次 `[纠正]` 提示再请求；仍坏则 error（`模型本轮输出异常（只含工具标记、回显了提示词或重复退化）`）+ `done.message=""`。
- 流式看门狗：累计内容每增长 2000 字检查一次，命中 `prompt_echo`/`repetition`/`markup_prefix` 立即中断上游流，不再为垃圾输出继续烧 token。
- 历史错误的渲染：落库的错误块是 `{type:'error', message}`（实时流用 `content`），前端 `parseAnswerBlocks` 两者都接受，避免失败记录显示成空白 Alert。

---

## 2.8 真正的「一直重复 / 最后中断」根因（2026-11-03 补，GLM 同样复现）

用户用 GLM 跑同一个分析也出现「反复从『我先探索数据库结构』重来、最后中断」，说明与模型无关，是我们自己的两个 bug：

1. **历史窗口裁剪把当前问题裁掉了**（致命）。`_trim_history` 只在一个窗口内寻找 `user` 边界，而一轮 agent 对话只有开头一个 user 消息；当消息数超过 `max_history_messages + 2`（默认 22）后，窗口里找不到 user，循环一路推进到末尾 → 裁剪结果只剩 system（tool 消息还被当孤儿丢掉）。于是**每一轮发给模型的内容里都没有问题本身**，模型只能凭系统提示词（含 skill 文本）重新规划 → 每 ~20 次工具调用就来一次「重新探索数据库」，永远走不到结论。
   修复：始终保留最后一个 `user` 消息（当前问题），先丢最老的历史；尾部在 `assistant` 边界处裁剪（assistant 不依赖前文，而 tool 回复必须跟在其 assistant 调用之后），并继续剥离开头孤立的 tool 消息。
2. **工具结果 JSON 序列化崩溃**。`asyncpg` 返回 `datetime` / `Decimal`，`json.dumps` 直接抛 `Object of type datetime is not JSON serializable`：SSE 的 `result` 事件在流中途抛错（用户看到「最后中断」），回给模型的 tool_result 也变成 `Query execution failed: ...`，模型于是换写法重试同一个查询。
   修复：`_sse_event` 与结果预览统一 `default=str`，时间/金额以字符串形式进入结果与模型上下文。
3. 结果预览此前固定 `rows[:min(20, max_result_rows)]`，模型只能看到 245 张表里的 20 张，于是不断重查。现在预览按 `max_result_rows` 截断，并在被截断时附加 `note`：「只显示前 N 行，不要重复执行同一查询，请用聚合/过滤」。

---

## 2.9 「跑一小时也不结束」的真正原因：没有预算、没有记忆、没有去重（2026-11-03 补）

证据：2026-11-03 15:31 会话 31（`conversation_messages.id=188`，用户手动停止）：

- 单次查询 **846 条 SQL**（去重后 826 条）、67 条执行失败（8%）、258+ 轮 LLM 请求、时长 **3703s（61.7 分钟）**、结论区为空；
- `answer_blocks` 共 1,724 个块（846 sql / 779 result / 67 error / 32 think），结果载荷 1.95MB，模型产出的分析文字只有 32 段；
- **不是字面重复**（846 条里只有 14 条完全相同），而是三类结构性浪费：
  1. `src_emspcore__cdr_refactor` 一个 schema 占 657 条（78%），模型在 JSON 列上反复试错；
  2. 同一批表的列清单被重复 introspect 10–13 次（`evse` 13、`emsp_visible_mapping` 12、`charging_location` 12……），跑完 800 条后又在末尾重新列 `information_schema.tables` —— 典型「忘了自己查过什么」；
  3. 同一类错误反复重试：`function jsonb_pretty(json) does not exist`（该列是 `json` 不是 `jsonb`）、`column "is_del" does not exist`、`不允许执行多条 SQL 语句`，各 5–8 次。

根因与修复（均与具体模型无关）：

1. **没有预算感知 → 永远不收尾**。提示词只说「最多 500 轮」，模型不知道自己已经花了 40 分钟，也没有机制在用时过长时要求它交结论。
   新增两个可配置预算（「AI 查询通用设置」）：
   - `max_tool_calls`（默认 150，10–3000）：单次查询最多执行的 SQL 条数；
   - `max_query_seconds`（默认 900，60–7200）：单次查询总时长（秒）。
   用满 85% 时注入一次「[收敛提醒]」；用满时注入「[收尾]」并把下一轮请求的 `tool_choice` 置为 `none`，强制模型只输出结论；供应商忽略 `tool_choice` 时丢弃其工具调用、用同轮文本收尾；仍拿不到文本则 error + `done.message=""`（绝不静默）。
2. **没有跨窗口记忆 → 反复重新探索**。`max_history_messages=20` 只保留最近约 10 个工具结果，之前的 schema 结论会被裁掉。
   新增 `_RunMemo` 运行记忆：每条执行过的 SQL 压成一行（步骤号 / 数据库 / SQL 前 170 字 / 行数 / 前 2 行摘要），最多 60 行 6000 字，作为 `## Run progress` 段**在每轮请求时追加到 system 提示词**（不落库、不受裁剪影响），同时附带轮次 / SQL 数 / 已用时进度。
3. **重复执行没有拦截**。同一指纹（去注释、压空白、小写、去尾分号的 SQL）在本次查询内重复出现时不再打数据库：直接回 `[ALREADY EXECUTED at step N]` + 摘要；连续 3 次注入「[收敛提醒]」。失败与校验拒绝的 SQL 也记入指纹，避免原地重试。
4. **错误提示不可执行**。`_augment_sql_error()` 给常见错误追加一行修复建议：`json` 与 `jsonb` 的转换、不要猜列名先查 `information_schema.columns`、一次只提交一条 SELECT。
5. **顺带修掉的隐患**：mid-run 的 user 提示（`[收尾]` / `[收敛提醒]` / `[纠正]`）会挤掉当前问题 —— `_trim_history` 保留「最后一个 user」，问题因此被裁掉，模型重新开始。现在 `_with_run_context` 按消息身份把原问题显式保留在 system 之后。

新增配置（全部 `ai_query.` 前缀，仅存改动值，默认值在 `ai_query_settings.py`）：

| 键 | 默认 | 范围 | 含义 |
| --- | --- | --- | --- |
| `max_tool_calls` | 150 | 10–3000 | 单次查询最多执行的 SQL 条数 |
| `max_query_seconds` | 900 | 60–7200 | 单次查询总时长（秒） |

验收（`/tmp/test_agent_acceptance.py` 12–15）：

12. `max_tool_calls=5` → 只执行 5 条，第 6 次请求 `tool_choice=none`，`done.message` 为强制收尾产出的结论；
13. `max_query_seconds=1` + 慢查询 → 同样强制收尾，不再无限跑；
14. 相同 SQL 连续请求 → 只执行 1 次，工具回包带 `ALREADY EXECUTED`；
15. `max_history_messages=4` 时每轮 system 仍含 `Run progress` 与已执行 SQL 清单，且当前问题不丢。

---

## 3. 需求二：查询结束后折叠过程、只显示结论

### 3.1 现状

- 落库结构天然分层：`conversation_messages.answer_blocks` 里的 block `type` 为 `think` / `sql` / `result` / `error` / `summary`；后端在 `done` 时会把结论从最后一个 think 块里剪掉，单独落一个 `summary` 块（`routers/llm.py:359-383`）。前端 `BlockView`（`NLQueryPage.tsx:95-161`）把每种块顺序平铺渲染，所以历史消息里「过程 + 结论」全摆在屏幕上。
- 流式视图（`NLQueryPage.tsx:1076-1134`）同理：`s.blocks` + `s.think` 全部展开，完成（`phase === 'done'`）后也不会收起。

### 3.2 方案（纯前端，不改 SSE 协议）

新增 `frontend/src/components/AnswerBlocks.tsx`：

```
props: { blocks: StreamBlock[]; think?: string; llmTimeMs?: number; collapsible: boolean }
```

- 分组：`summary` 块 = 结论区（始终可见，渲染在最前）；`think`/`sql`/`result`/`error` = 过程区。
- 无 `summary` 块（历史旧数据只有 think）→ 退化为现状平铺，不做折叠，避免出现「空结论 + 折叠过程」的黑屏感。
- 有结论时：
  - 顶部 = `summary` 块（`Tag: 分析完成` + Markdown），即用户打开会话第一眼就能读到结论；
  - 其下 = 一行可点击的过程条：`▸ 分析过程 · {N} 步 · {耗时}`（`steps = 过程块数 + think 有内容则算 1`），默认**折叠**；
  - 点击展开/收起（`useState`，按消息 id 记忆在组件 state 内），展开后按原顺序渲染过程块。
- 流式期间 `collapsible=false`（进行中要看过程）；`done`/`stopped`/`error` 终态时 `collapsible=true`。
- 未落库的流在 `done` 后会同时出现在历史消息与流视图里吗？不会：`messages` 只在切换会话/刷新时拉取，`queryStreamManager` 在新建会话跳转后把旧流 `hidden`（`queryStreamManager.ts:176-180`），因此两处都用同一组件即可，不会重复渲染。
- i18n 新增：`block.process`（分析过程 / Process）、`block.processSteps`（{{count}} 步）、`block.expandProcess` / `block.collapseProcess`（或直接用 aria-label）。

### 3.3 兼容性

- 不改变 SSE 事件、不改 `answer_blocks` 结构 → 老会话照常打开（无 summary 的走退化分支）。
- 折叠状态不落库：刷新后默认折叠（符合「结论优先」）。
- 复制/导出：`summary` 块内容仍在 DOM 内，不受影响（折叠过程只是隐藏）。

---

## 4. 验收

1. `GET/PUT /api/v1/ai-query-settings` 返回合并后的有效值 + 默认值；非法值 422；`max_tokens: null` 能清空覆盖。
2. 把「轮次上限」改成 3，提问复杂问题 → 后端日志出现 `stage=max_rounds`，界面出现明确「已执行最大轮数」提示（不再静默）。
3. 把「单轮输出 token 上限」调小（如 200）→ 触发 `finish_reason=length`，自动续写 1 次；额度用尽后出现「输出达到 token 上限被截断」提示，结论块不会被半截内容冒充。
4. 「请求超时」调到 10s，慢查询 → 出现「已超时，结论不完整」提示且过程块保留。
5. 历史会话：结论在上、`分析过程 · N 步` 折叠条在下；点击展开/收起正常；刷新后仍默认折叠。
6. 进行中的查询：过程仍实时展开显示，结束后自动收起为折叠条。
7. `cd frontend && npm run build` 通过；后端 `python -c "import app.main"` 通过；zh/en 两套文案无缺失键。

## 5. 实施顺序

1. 后端：DDL + `SettingsStore` + `ai_query_settings.py` + schema + 路由。
2. 后端：`llm_agent_service.py` 接线（轮次 / token / 超时 / 行数 / finish_reason 续写 / 历史裁剪）+ `routers/llm.py` 传参。
3. 前端：API 层 + `LLMConfigPage` 通用设置卡片 + i18n。
4. 前端：`AnswerBlocks.tsx` + `NLQueryPage` 两处替换 + i18n。
5. 自测 + 构建 + 提交（中文 conventional commit，两条独立提交）。
