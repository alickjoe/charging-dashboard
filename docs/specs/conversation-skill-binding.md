# 会话级技能绑定（Skill 常驻）Spec

- 状态：**已实施（2026-10-30）**
- 关联问题：同一会话不同消息显示的 skills 不一致；切换会话时技能选择会被静默带走
- 涉及模块：后端 conversations/skills/llm + SQLite、前端 NLQuery 页

---

## 1. 背景（2026-10-29 核实结论）

当前 skill 是「按消息发送」的：

- 只有输入框 `+ Add Skill` 里选中、并随该次请求发出的 `skill_ids` 才会注入系统提示词，并逐条存入 `conversation_messages.skill_ids`；
- 左侧会话卡片紫色标签 = 该会话**历史所有消息**的 skill 并集（去重、按 id 排序）；
- 技能选择只存在于前端内存：重开应用/新建会话会清空，打开老会话不会恢复；而切换会话**不会清空**，会把技能静默带到另一个会话（真问题）。

实测数据（本机 DB，会话 27「Get all the visible locations/」11 条用户消息）：

| 消息 | skill_ids | 显示 |
|---|---|---|
| 135 / 137 / 139（前 3 轮） | `[4, 1]`（roaming + location-segmentation） | 消息上有 2 个紫色标签 |
| 145 ~ 159（后 8 轮） | `[]` | 消息上无紫色标签 |
| 会话列表卡片 | 并集 `[1, 4]` | 显示 2 个标签 |

所以「有的消息有、有的没有」在数据上是真实的，但语义和界面容易让人误解。

**目标**：把技能提升为「会话级状态」——每个会话有自己绑定的技能集合，打开会话自动回填到输入框，新增/移除立即持久化，之后每条消息默认携带；切换会话是替换而不是沿用。

**非目标**：不改变 skill 提示词注入机制；不改变 SSE 协议；不做技能自动推荐。

---

## 2. 目标语义（行为矩阵）

| 场景 | 目标行为 |
|---|---|
| 打开一个会话 | 输入框上方回填该会话绑定的 skills（chips） |
| 在会话中新增/移除 skill | 立即持久化到该会话；刷新/重启后仍在 |
| 会话中发送消息 | 总是携带当前绑定的 `skill_ids`（可能是 `[]`） |
| 切换到另一个会话 | 选择替换为目标会话的绑定，不沿用上一个会话的 |
| 新建会话（New Chat） | 选择清空（沿用现有行为） |
| 新会话发第一条消息 | 建会话时把当前 `skill_ids` 一并写入 |
| 左侧会话卡片 chips | = 该会话**历史所有消息的 skill 并集**（保持现状语义），tooltip 说明"这是历史使用记录" |
| 输入框上方 chips | = 该会话**当前绑定**的技能（打开/切换会话时恢复） |
| 每条旧消息的紫色 chips | 保持 = 该消息历史真实使用的技能（不变） |

> 决策 2（2026-10-30 已确认）：左侧卡片保留历史并集。因此列表/详情接口同时返回两个字段：
> `skill_ids` = 历史并集（供卡片 chips），`bound_skill_ids` = 当前会话绑定（供输入框恢复）。
| 清空所有 skill | 持久化为 `[]`；重启后不会被迁移/回填「复活」 |
| 删除某个 skill | 从所有会话绑定中移除；历史消息 chips 维持现状（静默隐藏） |

---

## 3. 数据模型

`conversations` 表新增列：

```sql
skill_ids TEXT NOT NULL DEFAULT '[]'   -- JSON int 数组，如 "[4, 1]"，顺序 = 用户选择顺序
```

- DDL（新建库）直接包含该列；
- 旧库迁移：`init_db()` 中 `ALTER TABLE ... ADD COLUMN ...`（沿用现有 try/except 迁移模式）；
- **回填只执行一次**：仅在 `ALTER` 成功的启动里回填，写法为「每条会话取最后一条消息的 `skill_ids`」，解析失败或空表则 `[]`。
  - 原因：不能每次启动按 `skill_ids = '[]'` 回填，否则用户主动清空后重启会被"复活"。
  - 旧会话结果：会话 27（最后一条消息为 `[]`）→ 打开后无技能；会话 28（`[2]`）→ 打开后为 cdr-segment。

`conversation_messages.skill_ids` 保持不变（历史每轮真实使用的技能）。

---

## 4. 后端改动

### 4.1 `backend/app/sqlite_store.py`

- DDL：`conversations` 增加 `skill_ids`。
- 迁移：新增列 + 一次性回填（见第 3 节）。
- 新增 `_parse_skill_ids(raw) -> list[int]`：容错 JSON、非 list、非 int，输出去重保序的 int 列表。
- `ConversationStore.create(..., skill_ids: str = '[]')`：写入会话初始绑定。
- `ConversationStore.list_all()`：保留原有"按 message 聚合并集"逻辑（`skill_ids` = 历史并集），**另外**把会话列解析为 `bound_skill_ids`（当前绑定）。
- `ConversationStore.get_by_id()`：解析出 `skill_ids`（历史并集，供详情接口）与 `bound_skill_ids`（当前绑定）。
- 新增 `ConversationStore.update_skill_ids(conversation_id, skill_ids: str) -> dict | None`（**不更新 `updated_at`**，避免改技能把会话顶到列表最前）。
- 新增 `ConversationStore.remove_skill_id_everywhere(skill_id: int) -> None`：遍历会话，从 `skill_ids` 中移除该 id（数量小，直接遍历即可）。

### 4.2 `backend/app/schemas/conversation.py`

- `ConversationResponse` 增加 `bound_skill_ids: list[int] = []`（当前绑定；`skill_ids` 仍是历史并集）。
- `ConversationDetailResponse` 增加 `skill_ids: list[int] = []`（历史并集，当前缺失）与 `bound_skill_ids: list[int] = []`（当前绑定）。
- 新增：

```python
class UpdateConversationSkillsRequest(BaseModel):
    skill_ids: list[int] = []

class ConversationSkillsResponse(BaseModel):
    id: int
    skill_ids: list[int]
```

### 4.3 `backend/app/routers/conversations.py`

- `GET /api/v1/conversations`：`skill_ids` 来自会话列（`_row_to_response` 不变）。
- `GET /api/v1/conversations/{id}`：返回详情时含 `skill_ids`（历史并集）与 `bound_skill_ids`（当前绑定）。
- 新增 `PUT /api/v1/conversations/{id}/skill-ids`：
  - body：`{"skill_ids": [4, 1]}`
  - 去重保序；校验会话存在（404 `会话 ID=x 不存在`）；
  - 校验所有 id 在 `skills` 表存在，未知 id → 400 `未知技能 ID: [...]`；
  - 写入并返回 `ConversationSkillsResponse`。

### 4.4 `backend/app/routers/llm.py`（nl-query-stream）

- 计算本次请求的 **effective_skill_ids**：
  - `body.skill_ids is not None` → 直接使用（空数组即显式不使用技能）；
  - `body.skill_ids is None` 且 `conversation_id` 存在 → 读取会话 `skill_ids` 兜底（兼容旧前端/未传字段）；
  - 新建会话 → `body.skill_ids or []`。
  - 注意判断必须用 `is not None`，不能用真值判断（空数组是合法值）。
- 用 `effective_skill_ids` 加载技能 prompt（现有逻辑不变）。
- 消息落库的 `skill_ids` 使用 `effective_skill_ids`。
- 在 `persist_exchange` 中同步 `ConversationStore.update_skill_ids(conversation_id, ...)`，作为前端 PATCH 失败/旧前端的兜底；重复执行幂等。
- 新建会话时 `ConversationStore.create(..., skill_ids=json.dumps(effective_skill_ids))`。

### 4.5 `backend/app/routers/skills.py`

- `DELETE /api/v1/skills/{id}` 成功后调用 `ConversationStore.remove_skill_id_everywhere(id)`，清理会话绑定。

---

## 5. 前端改动

### 5.1 `frontend/src/api/conversations.ts`

```ts
export async function updateConversationSkills(id: number, skillIds: number[]) {
  const { data } = await api.put<{ id: number; skill_ids: number[] }>(
    `/conversations/${id}/skill-ids`,
    { skill_ids: skillIds },
  );
  return data;
}
```

### 5.2 `frontend/src/pages/NLQueryPage.tsx`

状态与数据流：

- 保留 `selectedSkillIds` 作为「当前会话绑定的编辑副本」。
- 新增：
  - `skillsDirtyRef`：用户手动改过选择后置 `true`，防止详情接口晚到覆盖用户操作；切换会话时重置。
  - `skillsSaveTimerRef` + `pendingSkillsRef`：约 300ms 防抖、latest-wins 保存；unmount 时 flush。
  - `lastSavedSkillsRef`：保存失败时回滚用。
- 统一入口 `applySkillSelection(nextIds)`（新增/移除/清空都走它）：
  1. `setSelectedSkillIds(nextIds)`；`skillsDirtyRef = true`；
  2. 若无 `activeConvId`（新会话）→ 只保留本地状态；
  3. 若有 → 防抖调用 `PUT /conversations/{id}/skill-ids`；成功 `invalidateQueries(['conversations'])` 并更新 `lastSavedSkillsRef`；失败 toast + 回滚到 `lastSavedSkillsRef`；
  4. 响应返回时若 `activeConvId` 已变化，只 invalidate，不改当前 UI（防串会话）。
- `handleSelectConv(conv)`：`setSelectedSkillIds(conv.bound_skill_ids ?? [])`、`skillsDirtyRef = false`（列表接口已返回当前绑定，立即生效）。
- 详情加载 effect：当 `!skillsDirtyRef.current` 时用 `detail.bound_skill_ids` 校正一次（防列表数据过期）；meta 其余逻辑不变。
- `handleNewChat()`：清空选择与 pending timer（现有行为 + 清理定时器）。
- `handleSend()`：始终显式传 `skillIds: selectedSkillIds`（含空数组）；发送前 flush 一次 pending 保存，确保会话绑定与消息记录一致。
- skills 列表加载后：从 `selectedSkillIds` 中过滤已删除的技能 id；若发生了过滤且当前有会话 → 触发一次保存清理（避免删除技能后旧绑定复活）。
- 会话卡片 chips：沿用 `conv.skill_ids`（历史并集，语义不变），外面包 `Tooltip`：
  - zh：`本会话历史使用过的技能（不是当前生效）`
  - en：`Skills used historically in this conversation (not currently active)`
- 输入框上方 chips、`+ Add Skill`、`/` 自动补全交互不变。

### 5.3 i18n

- `frontend/src/i18n/locales/zh.json` / `en.json` 增加上述 tooltip 文案。

### 5.4 流式查询兼容

- 运行中的 stream 使用 `start()` 时的 `skillIds` 快照（已固化在 params 里），之后改选择不影响进行中的查询；切会话仍不 abort（沿用 2026-09-10 架构约定）。

---

## 6. 边界与异常

| 情况 | 处理 |
|---|---|
| 旧会话升级 | 迁移回填最后一条消息的 skills；只回填一次 |
| 用户清空技能后重启 | 保持 `[]`，不回填复活 |
| PATCH 失败 | toast 提示 + 回滚 UI；下次修改重试；发送时后端仍会按 effective 值兜底同步 |
| 并发多端 | 打开会话以详情为准（未 dirty 时）；发送时以本端选择为准并覆盖绑定 |
| 技能被删除 | 后端清理所有会话绑定；前端过滤 + 懒清理 |
| 会话被删除 | 清空选择与 pending 保存（现有逻辑补充） |
| 新前端 + 旧后端 | PUT 404 时静默降级（不阻塞选择与发送），功能不完整但不报错 |
| 中途断开/partial persist | 仍更新会话绑定与消息 skill_ids（幂等） |

---

## 7. 改动文件清单

后端：

- `backend/app/sqlite_store.py`
- `backend/app/schemas/conversation.py`
- `backend/app/routers/conversations.py`
- `backend/app/routers/llm.py`
- `backend/app/routers/skills.py`

前端：

- `frontend/src/api/conversations.ts`
- `frontend/src/pages/NLQueryPage.tsx`
- `frontend/src/i18n/locales/zh.json`、`en.json`

构建/部署（本机验证用，产物不入库）：

- 重建 `frontend/dist`（`VITE_ELECTRON_BUILD=true`）
- 更新本机全局安装 `aidbquery` 的 `vendor/frontend-dist` 与 `vendor/backend/app`
- 操作前备份 `%APPDATA%\aidbquery\data\config.db`（含 `-wal`/`-shm`）

---

## 8. 验收标准

1. 打开会话 27：输入框 chips 为空（其最后一条消息为 `[]`）；打开会话 28：chips 为 `cdr-segment`。
2. 会话 A 选中 `roaming` → 切到会话 B：B 显示自己的绑定（不串）；切回 A 仍显示 `roaming`。
3. 在会话中新增 `location-segmentation` → 刷新页面/重启应用后仍在。
4. 清空全部 chips → 刷新后仍为空（不被回填复活）。
5. 历史消息的紫色 chips 与升级前一致（逐条真实记录不变）。
6. 左侧卡片 chips 仍为历史并集（升级前后显示一致）、tooltip 为"历史使用过的技能"；输入框 chips = 当前绑定；改技能不改变会话在列表中的排序。
7. 新会话选技能并发送第一条消息 → 会话详情的 `skill_ids` 与发送时一致；重启后恢复。
8. 删除某技能 → 所有会话绑定中移除；历史消息 chips 静默消失（现状）。
9. `npm run build`（tsc + vite）通过；后端接口用临时 DATA_DIR 验证通过，未污染真实数据。

---

## 9. 验证计划

- **后端**：
  - 复制真实 `config.db` 到临时 `DATA_DIR`，启动 `uvicorn`（18000 端口）；
  - 验证 `GET /conversations`、`GET /conversations/27`、`PUT /conversations/27/skill-ids`（正常/未知 id/404/去重/空数组）；
  - 构造旧 schema 的临时库，启动后端验证「加列 + 回填只一次」；清空后再重启验证不回填；
  - 删除技能验证会话绑定清理。
- **前端**：
  - `VITE_ELECTRON_BUILD=true npm run build`；
  - 无头 Electron（复用白屏排查时的 harness 方式）加载构建产物并指向测试后端，用 `executeJavaScript` 验证：打开会话恢复 chips、切会话替换、增删后查 DB、清空后重启不回填。
- **手工**：更新本机应用后按第 8 节逐条点一遍（真实 DB 只做只读核对，写入测试用副本）。

---

## 10. 发布与回滚

- 发布：重建前端 + 更新本机 `vendor`（前端与后端）→ 重启应用自动迁移；正式分发需 bump 版本并重建 npm 包/exe（CI）。
- 回滚：恢复 `config.db` 备份 + 还原 `vendor` 文件；代码层面 revert 本次改动。新列对旧代码无影响（旧代码忽略该列）。
- 兼容：旧前端连新后端正常；新前端连旧后端 PATCH 404 时降级。

---

## 11. 决策记录（2026-10-30 已确认）

1. **旧会话回填规则**：按「该会话最后一条消息的 skills」回填（会话 27 → 空；会话 28 → cdr-segment）。
2. **左侧会话卡片 chips**：**保留历史并集**（语义不变）。因此接口同时返回 `skill_ids`（并集）与 `bound_skill_ids`（当前绑定），输入框恢复用后者。
3. **删除技能后的历史消息 chips**：静默隐藏（维持现状）。
4. **PUT 是否刷新会话 `updated_at`**：不刷新（列表排序稳定）。
5. **发送时是否总是显式传 `skill_ids`**：总是传（含空数组）。

---

## 12. 实施记录（2026-10-30）

### 12.1 代码改动

- 后端：
  - `sqlite_store.py`：`conversations.skill_ids` DDL、一次性回填 `_backfill_conversation_skill_ids()`、`_parse_skill_ids()`、`_skill_union()`、`ConversationStore.create(..., skill_ids=)`、`update_skill_ids()`、`remove_skill_id_everywhere()`；`list_all()` 同时返回历史并集 `skill_ids` 与当前绑定 `bound_skill_ids`。
  - `schemas/conversation.py`：两个响应增加 `bound_skill_ids`，详情补 `skill_ids`；新增 `UpdateConversationSkillsRequest`、`ConversationSkillsResponse`。
  - `routers/conversations.py`：`PUT /api/v1/conversations/{id}/skill-ids`（去重保序 / 未知 id 400 / 404）；`_row_to_response` 兼容原始 JSON 字符串（顺带修复 create 接口 `connection_schemas` 未解析的旧问题）。
  - `routers/llm.py`：`effective_skill_ids`（显式列表优先，`None` 才回落会话绑定）、新建会话写入技能、落库消息后同步会话绑定。
  - `routers/skills.py`：删除技能时清理所有会话绑定。
- 前端：
  - `api/conversations.ts`：`updateConversationSkills()`。
  - `types/index.ts`：`Conversation.bound_skill_ids`。
  - `NLQueryPage.tsx`：打开/切换会话恢复绑定；增删 chips 走 `applySkillSelection()`（300ms 防抖保存、失败回滚）；`skillsDirtyRef` 防详情晚到覆盖；切会话前 flush 未保存修改；离开页面 flush；删除技能后过滤失效 id 并清理绑定；发送时总是传 `skill_ids`；会话卡片 chips 保持历史并集并加 tooltip。
  - `zh.json` / `en.json`：`chat.skillsHistoryTooltip`、`chat.errSaveSkills`。

### 12.2 验证结果（临时 DATA_DIR 副本 + 无头 Electron）

- 迁移：旧库启动后自动加列；回填会话 27 → `[]`、会话 28 → `[2]`；模拟重启后不重复回填（用户清空不会被复活）。
- 接口：list/detail 同时返回并集与绑定；PUT 去重 `[1,4,1]→[1,4]`、未知技能 400、不存在会话 404；技能删除后绑定被清理；新建会话 → PUT → 详情一致。
- 前端 E2E（安装版 Electron + 构建产物 + 测试后端）：
  - 打开会话 27：输入框无 chips；会话 28：`/cdr-segment`；切回 27 不串会话。
  - 添加 `roaming` → UI 与 DB 均变为 `[4]`；刷新应用后恢复；点 × 清空 → DB 变 `[]`。
  - 会话卡片仍显示历史并集（`location-segmentation`、`roaming`）；消息级 chips 不变；控制台 0 错误。

### 12.3 本机应用更新（npm 全局安装 `aidbquery`）

- 已备份到 `%APPDATA%\aidbquery\backup-skillbinding-20261030\`：
  - `config.db`（SQLite backup API 一致性快照）
  - `vendor-backend-app/`（旧后端源码）
  - `vendor-frontend-dist/`（旧前端构建）
- 已替换安装目录中的 `vendor/frontend-dist/`（新 bundle `index-DlswbHRl.js`）与 5 个后端源文件。
- **需要关闭窗口并重新运行 `adq`**：新后端启动时会自动执行 `init_db()` 迁移（加列 + 一次性回填），旧数据不受影响。

### 12.4 回滚

1. 关闭应用；
2. 用备份覆盖 `%APPDATA%\aidbquery\data\config.db`（若已迁移过）；
3. 还原 `vendor-backend-app/` 与 `vendor-frontend-dist/` 对应文件；
4. 重启应用。新列对旧代码无影响（旧代码忽略该列）。
