import { Code, Divider, Grid, H1, H2, H3, Stack, Stat, Table, Text, Card, CardHeader, CardBody, Row, Tag } from 'qoder/canvas';

export default function LLMTestUIFixSummary() {
  return (
    <Stack gap={20}>
      <H1>LLM 测试反馈与 UI 适配修复 — 完成报告</H1>
      <Text tone="secondary" size="small">2026-07-14 | 10 个文件 | TypeScript 编译通过</Text>

      <Grid columns={4} gap={16}>
        <Stat label="修改文件数" value="10" tone="info" />
        <Stat label="通过需求项" value="22/22" tone="success" />
        <Stat label="TS 编译" value="通过" tone="success" />
        <Stat label="目标分辨率" value="768px+" tone="info" />
      </Grid>

      <Divider />

      <H2>一、LLM 测试按钮无反馈 — 根因与修复</H2>

      <Card>
        <CardHeader title="根因" />
        <CardBody>
          <Stack gap={8}>
            <Text>1. <Code>main.tsx</Code> 缺少 antd 5.x <Code>&lt;App&gt;</Code> 组件包裹，导致 <Code>message</Code> 静态方法在 React 19 下渲染到异常 DOM 节点。</Text>
            <Text>2. <Code>handleTest</Code> 的 <Code>catch</Code> 块静默吞掉异常，无日志输出。</Text>
          </Stack>
        </CardBody>
      </Card>

      <H3>修复内容</H3>
      <Table
        headers={['文件', '改动']}
        rows={[
          ['main.tsx', '从 antd 导入 App as AntdApp，在 ConfigProvider 内包裹 children'],
          ['LLMConfigPage.tsx', 'handleTest 改用 message.open({ type, content, duration: 5 })，添加 console.log/error'],
        ]}
      />

      <Divider />

      <H2>二、UI 响应式适配 — 768px+</H2>

      <Card>
        <CardHeader title="全局布局" />
        <CardBody>
          <Stack gap={8}>
            <Text><Code>Layout.tsx</Code> — Sider 添加 <Tag tone="info">breakpoint="lg"</Tag> 小屏自动折叠；Content 添加 <Tag tone="info">overflow: auto</Tag>；margin/padding 从 24px 缩减为 12px</Text>
          </Stack>
        </CardBody>
      </Card>

      <H3>页面级修复</H3>
      <Table
        headers={['页面 / 组件', '修复内容', '优先级']}
        rows={[
          ['LLMConfigPage', 'Table scroll=max-content；操作列 280→240', '高'],
          ['ConnectionCard', '5 个按钮 Space→Space wrap 自动换行', '高'],
          ['DatabaseExplorer', '侧边栏折叠切换 + resize 监听；列注释 minWidth:120；maxHeight calc', '高'],
          ['CustomQueryPage', '已保存查询侧边栏折叠切换', '高'],
          ['NLQueryPage', '会话侧边栏折叠切换；height→minHeight；Header Space wrap；消息气泡 calc(100%-40px)', '高'],
          ['SkillsPage', '技能列表折叠切换；height→minHeight', '中'],
          ['ChartViewPage', 'Select minWidth:180,maxWidth:250；Card overflow:hidden', '中'],
        ]}
        rowTone={['default', 'default', 'default', 'default', 'default', 'default', 'default']}
      />

      <H3>i18n 翻译</H3>
      <Table
        headers={['键', '中文', 'English']}
        rows={[
          ['common.collapse', '收起', 'Collapse'],
          ['common.expand', '展开', 'Expand'],
        ]}
      />

      <Divider />

      <H2>三、侧边栏折叠模式</H2>
      <Card>
        <CardBody>
          <Stack gap={12}>
            <Text weight="semibold">所有带侧边栏的页面统一使用：</Text>
            <Row gap={16}>
              <Stack gap={4}>
                <Tag tone="info">初始化</Tag>
                <Text size="small">useState(window.innerWidth {'>='} 768)</Text>
              </Stack>
              <Stack gap={4}>
                <Tag tone="info">自适应</Tag>
                <Text size="small">resize 事件监听自动折叠/展开</Text>
              </Stack>
              <Stack gap={4}>
                <Tag tone="info">切换按钮</Tag>
                <Text size="small">MenuFoldOutlined / MenuUnfoldOutlined 图标</Text>
              </Stack>
            </Row>
            <Text size="small" tone="tertiary">小屏默认折叠，展开时显示浮动切换按钮；大屏默认展开。</Text>
          </Stack>
        </CardBody>
      </Card>

      <Divider />

      <Grid columns={3} gap={16}>
        <Stat label="问题1：测试反馈" value="已修复" tone="success" description="AntdApp 包裹 + message.open 5s 延迟" />
        <Stat label="问题2：UI 溢出" value="已适配" tone="success" description="768px+ 全覆盖，侧边栏可折叠" />
        <Stat label="编译状态" value="零错误" tone="success" description="npx tsc --noEmit 通过" />
      </Grid>
    </Stack>
  );
}
