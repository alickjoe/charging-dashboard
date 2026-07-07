import {
  H1,
  H2,
  Text,
  Table,
  Stat,
  Grid,
  Divider,
  Stack,
  Card,
  CardHeader,
  CardBody,
  Callout,
} from "qoder/canvas";

export default function SqlQueryEditorSummary() {
  return (
    <Stack gap={20}>
      <H1>自定义 SQL 查询编辑器 - 实现完成</H1>
      <Text tone="secondary" size="small">
        共 10 个任务，覆盖后端存储 / Schema / Router 和前端页面 / 路由 / 导航 / i18n
      </Text>

      <Grid columns={4} gap={16}>
        <Stat value="12" label="变更文件" tone="primary" />
        <Stat value="5" label="API 端点" tone="success" />
        <Stat value="10" label="实现任务" />
        <Stat value="2" label="入口导航点" />
      </Grid>

      <Divider />

      <H2>后端变更 (4 文件)</H2>
      <Table
        headers={["文件", "变更内容", "状态"]}
        rows={[
          ["sqlite_store.py", "DDL 新增 saved_queries 表 + SavedQueryStore 类 (5 个 CRUD 方法)", "完成"],
          ["schemas/custom_query.py", "ExecuteQueryRequest/Response, SavedQueryCreate/Update/Response - 5 个 Pydantic 模型", "完成"],
          ["routers/custom_query.py", "5 个 API 端点: 执行查询 + 已保存查询 CRUD", "完成"],
          ["main.py", "注册 custom_query 路由", "完成"],
        ]}
        rowTone={["success", "success", "success", "success"]}
      />

      <Divider />

      <H2>前端变更 (8 文件)</H2>
      <Table
        headers={["文件", "变更内容", "状态"]}
        rows={[
          ["types/index.ts", "新增 5 个 TypeScript 接口", "完成"],
          ["api/customQuery.ts", "新建 - 5 个 API 函数", "完成"],
          ["pages/CustomQueryPage.tsx", "新建 - SQL 查询编辑器页面 (~400 行)", "完成"],
          ["App.tsx", "注册 /queries/:connectionName 路由", "完成"],
          ["ConnectionCard.tsx", "新增 SQL 查询按钮 (CodeOutlined)", "完成"],
          ["DatabaseExplorerPage.tsx", "顶部操作栏新增 SQL 查询导航按钮", "完成"],
          ["i18n/zh.json", "新增 customQuery 命名空间 (15 个键)", "完成"],
          ["i18n/en.json", "同上, 英文翻译", "完成"],
        ]}
        rowTone={["success", "success", "success", "success", "success", "success", "success", "success"]}
      />

      <Divider />

      <H2>API 端点</H2>
      <Table
        headers={["方法", "路径", "说明"]}
        rows={[
          ["POST", "/api/v1/connections/{name}/query", "执行只读 SQL (复用 sql_validator)"],
          ["GET", "/api/v1/connections/{name}/queries", "列出已保存查询"],
          ["POST", "/api/v1/connections/{name}/queries", "创建已保存查询"],
          ["PUT", "/api/v1/connections/{name}/queries/{id}", "更新已保存查询"],
          ["DELETE", "/api/v1/connections/{name}/queries/{id}", "删除已保存查询"],
        ]}
      />

      <Divider />

      <H2>功能特性</H2>
      <Grid columns={3} gap={12}>
        <Card>
          <CardHeader title="安全" />
          <CardBody>
            <Text tone="secondary" size="small">
              复用 sql_validator.validate_readonly_sql, 仅允许 SELECT / WITH 查询。
              多条语句、写操作关键字均被拦截。
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="隔离" />
          <CardBody>
            <Text tone="secondary" size="small">
              已保存查询按 connection_name 隔离, 唯一索引 (connection_name, name)。
              每个连接的查询列表独立管理。
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="效率" />
          <CardBody>
            <Text tone="secondary" size="small">
              Ctrl+Enter 快捷键执行查询。等宽字体编辑器 (Consolas)。
              超 50 行结果自动前端分页。显示执行耗时。
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>关键设计决策</H2>
      <Callout tone="info" title="未加 Schema 选择器">
        自定义 SQL 语句本身已包含 schema 限定 (如 SELECT * FROM &quot;public&quot;.&quot;table&quot;),
        添加 schema 选择器反而会造成混淆和误导。
      </Callout>
      <Callout tone="info" title="未复用 DataTable 组件">
        DataTable 强依赖服务端分页字段 (page, page_size, total_rows),
        而自定义查询返回完整结果集, 直接用 Ant Design Table 配合前端分页更合理。
      </Callout>

      <Divider />

      <Grid columns={2} gap={16}>
        <Stat
          value="Python"
          label="语法编译验证"
          tone="success"
          description="所有 .py 文件通过 py_compile 检查"
        />
        <Stat
          value="JSON"
          label="i18n 文件验证"
          tone="success"
          description="zh.json 和 en.json 通过 json.load 解析, 无重复键"
        />
      </Grid>
    </Stack>
  );
}
import {
  H1,
  H2,
  H3,
  Text,
  Table,
  Stat,
  Grid,
  Divider,
  Stack,
  Card,
  CardHeader,
  CardBody,
  Tag,
  Callout,
} from "qoder/canvas";

export default function SqlQueryEditorSummary() {
  return (
    <Stack gap={20}>
      <H1>自定义 SQL 查询编辑器 — 实现完成</H1>
      <Text tone="secondary" size="small">
        共 10 个任务，覆盖后端存储 / Schema / Router 和前端页面 / 路由 / 导航 / i18n
      </Text>

      <Grid columns={4} gap={16}>
        <Stat value="12" label="变更文件" tone="primary" />
        <Stat value="5" label="API 端点" tone="success" />
        <Stat value="10" label="实现任务" />
        <Stat value="2" label="入口导航点" />
      </Grid>

      <Divider />

      <H2>后端变更 (4 文件)</H2>
      <Table
        headers={["文件", "变更内容", "状态"]}
        rows={[
          [
            "sqlite_store.py",
            "DDL 新增 saved_queries 表 + SavedQueryStore 类 (5 个 CRUD 方法)",
            "完成",
          ],
          [
            "schemas/custom_query.py",
            "ExecuteQueryRequest/Response, SavedQueryCreate/Update/Response — 5 个 Pydantic 模型",
            "完成",
          ],
          [
            "routers/custom_query.py",
            "5 个 API 端点：执行查询 + 已保存查询 CRUD",
            "完成",
          ],
          [
            "main.py",
            "注册 custom_query 路由",
            "完成",
          ],
        ]}
        rowTone={["success", "success", "success", "success"]}
      />

      <Divider />

      <H2>前端变更 (8 文件)</H2>
      <Table
        headers={["文件", "变更内容", "状态"]}
        rows={[
          [
            "types/index.ts",
            "新增 5 个 TypeScript 接口：CustomQueryRequest/Response, SavedQuery, SavedQueryCreate/Update",
            "完成",
          ],
          [
            "api/customQuery.ts",
            "新建 — 5 个 API 函数：execute, fetch, create, update, delete",
            "完成",
          ],
          [
            "pages/CustomQueryPage.tsx",
            "新建 — SQL 查询编辑器页面 (~400 行)：查询列表 + 编辑器 + 结果展示",
            "完成",
          ],
          [
            "App.tsx",
            "注册 /queries/:connectionName 路由",
            "完成",
          ],
          [
            "ConnectionCard.tsx",
            "新增「SQL 查询」按钮 (CodeOutlined 图标)",
            "完成",
          ],
          [
            "DatabaseExplorerPage.tsx",
            "顶部操作栏新增「SQL 查询」导航按钮",
            "完成",
          ],
          [
            "i18n/zh.json",
            "新增 customQuery 命名空间 (15 个键) + msg.saved/queryNameRequired",
            "完成",
          ],
          [
            "i18n/en.json",
            "同上，英文翻译",
            "完成",
          ],
        ]}
        rowTone={[
          "success", "success", "success", "success",
          "success", "success", "success", "success",
        ]}
      />

      <Divider />

      <H2>API 端点</H2>
      <Table
        headers={["方法", "路径", "说明"]}
        rows={[
          ["POST", "/api/v1/connections/{name}/query", "执行只读 SQL (复用 sql_validator)"],
          ["GET", "/api/v1/connections/{name}/queries", "列出已保存查询"],
          ["POST", "/api/v1/connections/{name}/queries", "创建已保存查询"],
          ["PUT", "/api/v1/connections/{name}/queries/{id}", "更新已保存查询"],
          ["DELETE", "/api/v1/connections/{name}/queries/{id}", "删除已保存查询"],
        ]}
      />

      <Divider />

      <H2>功能特性</H2>
      <Grid columns={3} gap={12}>
        <Card>
          <CardHeader title="安全" />
          <CardBody>
            <Text tone="secondary" size="small">
              复用 sql_validator.validate_readonly_sql，仅允许 SELECT / WITH 查询。
              多条语句、写操作关键字均被拦截。
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="隔离" />
          <CardBody>
            <Text tone="secondary" size="small">
              已保存查询按 connection_name 隔离，唯一索引 (connection_name, name)。
              每个连接的查询列表独立管理。
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="效率" />
          <CardBody>
            <Text tone="secondary" size="small">
              Ctrl+Enter 快捷键执行查询。等宽字体编辑器 (Consolas)。超 50 行结果自动前端分页。显示执行耗时。
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>关键设计决策</H2>
      <Callout tone="info" title="未加 Schema 选择器">
        自定义 SQL 语句本身已包含 schema 限定（如 SELECT * FROM "public"."table"），
        添加 schema 选择器反而会造成混淆和误导。
      </Callout>
      <Callout tone="info" title="未复用 DataTable 组件">
        DataTable 强依赖服务端分页字段 (page, page_size, total_rows)，
        而自定义查询返回完整结果集，直接用 Ant Design Table 配合前端分页更合理。
      </Callout>

      <Divider />

      <Grid columns={2} gap={16}>
        <Stat
          value="Python"
          label="语法编译验证"
          tone="success"
          description="所有 .py 文件通过 py_compile 检查"
        />
        <Stat
          value="JSON"
          label="i18n 文件验证"
          tone="success"
          description="zh.json 和 en.json 通过 json.load 解析，无重复键"
        />
      </Grid>
    </Stack>
  );
}
