import {
  H1,
  H2,
  H3,
  Stack,
  Grid,
  Row,
  Card,
  CardHeader,
  CardBody,
  Stat,
  Table,
  Tag,
  Callout,
  Divider,
  Text,
} from "qoder/canvas";

export default function NLQueryFixSummary() {
  const fileChanges = [
    {
      file: "frontend/src/components/Layout.tsx",
      change: "Content flex 布局改造",
      lines: "+7 / -3",
      tone: "info" as const,
    },
    {
      file: "frontend/src/pages/NLQueryPage.tsx",
      change: "高度约束 + 锚点导航",
      lines: "+89 / -2",
      tone: "info" as const,
    },
    {
      file: "frontend/src/components/ConnectionCard.tsx",
      change: "Toast 改用 i18n key",
      lines: "+2 / -2",
      tone: "info" as const,
    },
  ];

  return (
    <Stack gap={20}>
      <H1>NLQuery Page Three-Fix Report</H1>

      <Grid columns={3} gap={16}>
        <Stat
          value="3"
          label="Issues Resolved"
          tone="success"
          description="All verified complete"
        />
        <Stat
          value="3"
          label="Files Modified"
          tone="info"
          description="Surgical, no refactors"
        />
        <Stat
          value="Pass"
          label="Build Status"
          tone="success"
          description="TypeScript + Vite OK"
        />
      </Grid>

      <Divider />

      <H2>Fix 1: Scrollbar Browser Adaptation</H2>
      <Text tone="secondary" size="small">
        NLQueryPage used minHeight causing the entire viewport to stretch. Both sidebar and chat area now have independent vertical scrollbars constrained to viewport.
      </Text>

      <Row gap={16}>
        <Card size="sm" style={{ flex: 1 }}>
          <CardHeader title="Layout.tsx" />
          <CardBody>
            <Stack gap={8}>
              <Row gap={8}>
                <Tag tone="success">overflow: hidden</Tag>
                <Tag tone="success">flex: 1</Tag>
                <Tag tone="success">flex column</Tag>
              </Row>
              <Text tone="secondary" size="small">
                Content area reworked to use flex layout with a scrollable child wrapper, preserving scroll behavior for all other pages.
              </Text>
            </Stack>
          </CardBody>
        </Card>

        <Card size="sm" style={{ flex: 1 }}>
          <CardHeader title="NLQueryPage.tsx" />
          <CardBody>
            <Stack gap={8}>
              <Row gap={8}>
                <Tag tone="success">flex: 1</Tag>
                <Tag tone="success">minHeight: 0</Tag>
                <Tag tone="success">overflow: hidden</Tag>
              </Row>
              <Text tone="secondary" size="small">
                Outer container now fills Content area exactly. Sidebar (overflowY: auto) and messages area (overflowY: auto) get independent scrollbars.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Row>

      <Divider />

      <H2>Fix 2: User Message Anchor Navigation</H2>
      <Text tone="secondary" size="small">
        A floating numbered button panel appears on the right side of the messages area when a conversation has 2+ user messages. Click any button to smooth-scroll to that message.
      </Text>

      <Row gap={16}>
        <Card size="sm" style={{ flex: 1 }}>
          <CardHeader title="Implementation" />
          <CardBody>
            <Stack gap={8}>
              <Row gap={8}>
                <Tag>IntersectionObserver</Tag>
                <Tag>scrollIntoView</Tag>
                <Tag>useMemo filter</Tag>
              </Row>
              <Text tone="secondary" size="small">
                Each user message gets id="msg-{'{id}'}" and data-msg-id. IntersectionObserver with 0.4 threshold tracks visibility and highlights the active anchor button.
              </Text>
            </Stack>
          </CardBody>
        </Card>

        <Card size="sm" style={{ flex: 1 }}>
          <CardHeader title="UI Behavior" />
          <CardBody>
            <Stack gap={8}>
              <Row gap={8}>
                <Tag tone="info">circular buttons</Tag>
                <Tag tone="info">right-aligned</Tag>
                <Tag tone="info">hover tooltip</Tag>
              </Row>
              <Text tone="secondary" size="small">
                26px circular numbered dots in a floating panel. Active (visible) button turns blue. Hover shows the question text. Only renders when 2+ user messages exist.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Row>

      <Divider />

      <H2>Fix 3: Toast i18n for Connection Test</H2>
      <Text tone="secondary" size="small">
        ConnectionCard.tsx was using backend-returned Chinese strings directly in toast messages, bypassing the i18n system.
      </Text>

      <Table
        headers={["Before", "After"]}
        rows={[
          [
            'toast.success(`${result.message} (${result.latency_ms}ms)`)',
            "toast.success(t('msg.testSuccess', { ms }))",
          ],
          [
            "toast.error(result.message)",
            "toast.error(t('msg.testFail'))",
          ],
        ]}
        rowTone={["warning", "success"] as const}
      />

      <Callout title="i18n Keys Verified" tone="success">
        <Text size="small">
          Keys msg.testSuccess and msg.testFail exist in both zh.json ("测试成功/测试连接失败") and en.json ("Test successful/Test connection failed").
        </Text>
      </Callout>

      <Divider />

      <H3>File Change Summary</H3>
      <Table
        headers={["File", "Change Description", "Delta"]}
        rows={fileChanges.map((f) => [f.file, f.change, f.lines])}
        rowTone={fileChanges.map((f) => f.tone)}
      />

      <Callout title="Build Verification" tone="success">
        <Text size="small">
          TypeScript compilation: zero errors. Vite production build: completed in 31.32s. All changes are production-ready.
        </Text>
      </Callout>

      <Text tone="tertiary" size="small">
        Plan reference: NLQuery滚动锚点Toast修复_task-8e1.md
      </Text>
    </Stack>
  );
}
