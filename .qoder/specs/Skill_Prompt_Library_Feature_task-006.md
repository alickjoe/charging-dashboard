# Skill 提示词库功能实现计划

## 概述
将 AI 查询对话中的提示词抽象为可复用的 Skill。每个 Skill 包含系统提示词 + 用户提示词模板，在新对话中通过 `/skill-name` 调用，Skill 的系统提示词以**追加**方式扩充 AI Agent 的默认系统提示词（不覆盖系统级语言指令），多个 Skill 可叠加使用。

## 核心约束：不覆盖系统级语言指令

当前系统有三层语言保护：
1. 系统提示词顶部 `## CRITICAL LANGUAGE REQUIREMENT`（最先被 LLM 看到）
2. 系统提示词底部 Rule 8 `REMINDER: All output must be in {language}`（最后看到）
3. 用户消息注入 `[Language directive: respond in {lang_name}.]`（每次请求强制执行）

**Skill 追加位置**：在默认 `AGENT_SYSTEM_PROMPT` 整体之后、`## Database Schema` 之前追加 `## User-Defined Skills` 段落。这样顶部语言要求和底部 Rule 8 提醒都保持原有位置不变，用户消息的语言指令注入也完全不受影响。

---

## Task 1: 后端 - 数据库 Schema 新增 skills 表

**文件**: `backend/app/sqlite_store.py`

在 DDL 中新增 `skills` 表：
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL UNIQUE (用于 `/name` 调用)
- `description` TEXT NOT NULL DEFAULT ''
- `system_prompt` TEXT NOT NULL DEFAULT '' (扩充 Agent 系统提示词)
- `user_prompt_template` TEXT NOT NULL DEFAULT '' (用户查询模板)
- `source_questions` TEXT NOT NULL DEFAULT '[]' (JSON 数组，记录来源问题)
- `created_at`, `updated_at`

新增 `SkillStore` 类，提供 `list_all`, `get_by_id`, `get_by_name`, `create`, `update`, `delete` 静态方法。

---

## Task 2: 后端 - Skill Pydantic Schema

**新建文件**: `backend/app/schemas/skill.py`

定义：
- `SkillCreate` - 创建请求 (name, description, system_prompt, user_prompt_template, source_questions)
- `SkillUpdate` - 更新请求 (全部可选)
- `SkillResponse` - 响应模型
- `EnhancePromptRequest` - 增强请求 (raw_prompt, language)
- `EnhancePromptResponse` - 增强响应 (enhanced_prompt)

---

## Task 3: 后端 - 用户问题提取 API

**修改文件**: `backend/app/routers/conversations.py`

新增 `GET /api/v1/conversations/user-questions` 端点：
- 从 `conversation_messages` 表中查询所有 `role='user'` 的问题
- 去重返回，按时间倒序
- 返回 `{id, question, conversation_id, created_at}`

---

## Task 4: 后端 - Skills CRUD API

**新建文件**: `backend/app/routers/skills.py`

实现 RESTful 端点：
- `GET /api/v1/skills` - 列出所有 skills
- `POST /api/v1/skills` - 创建 skill
- `GET /api/v1/skills/{id}` - 获取 skill 详情
- `PUT /api/v1/skills/{id}` - 更新 skill
- `DELETE /api/v1/skills/{id}` - 删除 skill

**修改文件**: `backend/app/main.py` - 注册 `skills.router`

---

## Task 5: 后端 - 提示词增强 API

**修改文件**: `backend/app/routers/skills.py`

新增 `POST /api/v1/skills/enhance` 端点：
- 接收原始提示词和语言参数
- 使用默认 LLM 配置调用 AI 优化提示词
- 优化方向：更清晰的指令、补充上下文约束、结构化表达
- 返回增强后的提示词

---

## Task 6: 后端 - NL Query 流式接口支持 Skill 注入

**重要约束**：Skill 以追加方式插入，不覆盖系统级语言指令（见上方核心约束）。

**修改文件**: `backend/app/schemas/llm.py` - `NLQueryRequest` 新增 `skill_ids: Optional[list[int]]`

**修改文件**: `backend/app/routers/llm.py` - 在 `nl_query_stream` 中：
- 接收 `skill_ids`
- 从 SkillStore 加载对应 skills，提取 `system_prompt` 列表
- 将 skill_prompts 传入 `run_agent_stream`

**修改文件**: `backend/app/services/llm_agent_service.py` - `run_agent_stream` 新增 `skill_prompts: list[str] | None = None` 参数：
- 在 `system_prompt = AGENT_SYSTEM_PROMPT.format(...)` 之后追加 skill 段落到末尾
- 格式：`"\n\n## User-Defined Skills\n\n" + "\n\n".join(skill_prompts)`
- 用户消息注入 `[Language directive: ...]` 保持不变

---

## Task 7: 前端 - API 客户端

**新建文件**: `frontend/src/api/skills.ts`

实现前端 API 调用函数：
- `fetchSkills()` - 获取 skills 列表
- `createSkill(data)` - 创建 skill
- `updateSkill(id, data)` - 更新 skill
- `deleteSkill(id)` - 删除 skill
- `fetchUserQuestions()` - 获取历史用户问题
- `enhancePrompt(rawPrompt, language)` - AI 增强提示词

---

## Task 8: 前端 - TypeScript 类型定义

**修改文件**: `frontend/src/types/index.ts`

新增类型：
- `Skill` 接口
- `SkillFormData` 接口
- `UserQuestion` 接口
- `EnhancePromptResponse` 接口

---

## Task 9: 前端 - Skills 管理页面

**新建文件**: `frontend/src/pages/SkillsPage.tsx`

页面布局（左侧列表 + 右侧编辑表单）：
- **左侧**：已创建的 Skills 列表（卡片/列表项，支持删除）
- **右侧**：Skill 编辑表单
  - 名称输入 (name，即 `/name` 中的名称)
  - 描述输入
  - 系统提示词编辑区 (TextArea)
  - 用户提示词模板编辑区 (TextArea)
  - 保存按钮
  - 提示文字：提醒不要写语言覆盖指令

**"从历史问题创建"功能**：
- 按钮打开 Modal，展示所有历史用户问题列表
- 多选问题后创建 Skill，问题自动填充到 `user_prompt_template`

**"AI 增强"功能**：
- 编辑区旁放"AI 增强"按钮
- 调用 `/api/v1/skills/enhance`，返回优化结果

**修改文件**: `frontend/src/App.tsx` - 添加 `/skills` 路由

**修改文件**: `frontend/src/components/Layout.tsx` - 导航栏添加 "Skills" 菜单项

---

## Task 10: 前端 - NLQueryPage 集成 Skill 调用

**修改文件**: `frontend/src/pages/NLQueryPage.tsx`

在输入区域上方新增 Skill 选择栏：
- 显示已选中 Skill 的 Tag（可删除）
- 点击 "+" 弹出 Skill 选择下拉
- 支持输入 `/` 触发 Skill 自动补全
- 选中后传递 `skill_ids` 给流式接口

**修改文件**: `frontend/src/api/llm.ts`
- 请求体新增 `skill_ids` 字段

---

## Task 11: i18n 国际化

**修改文件**: `frontend/src/i18n/locales/zh.json`, `frontend/src/i18n/locales/en.json`

新增 skill 相关翻译键：
- `skills.title`, `skills.create`, `skills.edit`, `skills.delete`
- `skills.systemPrompt`, `skills.userPrompt`, `skills.description`
- `skills.enhance`, `skills.fromHistory`, `skills.selectQuestions`
- `skills.slashHint`, `skills.noLanguageOverrideHint`
- 相关按钮、确认提示等文本