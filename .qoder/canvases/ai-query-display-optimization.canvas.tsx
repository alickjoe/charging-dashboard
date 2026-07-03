import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Stack,
  Stat,
  Table,
  Tag,
  Text,
} from "qoder/canvas";

export default function AiQueryDisplayOptimization() {
  return (
    <Stack gap={20}>
      <H1>AI 查询结果显示格式优化</H1>

      <Stack gap={8}>
        <Text tone="secondary">
          修改文件: NLQueryPage.tsx (855 行)
        </Text>
        <Text tone="secondary">
          目标: 修复 markdown 表格渲染、对话切换竞态、文本溢出三大问题
        </Text>
      </Stack>

      <Grid columns={3} gap={16}>
        <Card>
          <CardHeader title="Markdown 表格" />
          <CardBody>
            <Stack gap={8}>
              <Text size="small" tone="secondary">
                新增 isTableSeparator / parseTableRow / findTableEnd
                三个辅助函数，重写 RenderMarkdown 支持检测并渲染竖线分隔的
                markdown 表格为 HTML table 元素。
              </Text>
              <Stat value="127" label="新增/修改行数" tone="success" />
              <Tag tone="success">第 38-164 行</Tag>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="竞态修复" />
          <CardBody>
            <Stack gap={8}>
              <Text size="small" tone="secondary">
                handleSelectConv 立即清除旧消息；useEffect 引入 cancelled
                标志位 + cleanup 函数，fetch 回调检查 cancelled 后操作状态。
              </Text>
              <Stat value="8" label="修改行数" tone="warning" />
              <Tag tone="warning">第 344-367, 501-502 行</Tag>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="溢出处理" />
          <CardBody>
            <Stack gap={8}>
              <Text size="small" tone="secondary">
                历史消息和流式消息气泡均添加 overflowX: auto 和 minWidth: 0；
                表格区域独立渲染，不受 whiteSpace: pre-wrap 干扰。
              </Text>
              <Stat value="4" label="修改行数" tone="info" />
              <Tag tone="info">第 735-736, 775-776 行</Tag>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>修改详情</H2>

      <Table
        headers={["任务", "变更", "行号", "状态"]}
        rows={[
          [
            "Markdown 表格渲染",
            "按行扫描检测竖线分隔行 → 分隔行验证 → 渲染 HTML table",
            "第 41-164 行",
            "完成",
          ],
          [
            "Markdown 表格渲染",
            "非表格文本保留原有 **粗体** / `代码` / 换行解析",
            "第 145-160 行",
            "完成",
          ],
          [
            "竞态条件",
            "handleSelectConv 添加 setMessages([])",
            "第 502 行",
            "完成",
          ],
          [
            "竞态条件",
            "useEffect cancelled 标志 + cleanup return",
            "第 350-366 行",
            "完成",
          ],
          [
            "溢出处理",
            "历史气泡 overflowX: auto + minWidth: 0",
            "第 735-736 行",
            "完成",
          ],
          [
            "溢出处理",
            "流式气泡 overflowX: auto + minWidth: 0",
            "第 775-776 行",
            "完成",
          ],
        ]}
        rowTone={[
          "success",
          "success",
          "warning",
          "warning",
          "info",
          "info",
        ]}
      />

      <Text tone="quaternary" size="small">
        Charging Dashboard - NLQueryPage 显示优化完成
      </Text>
    </Stack>
  );
}
