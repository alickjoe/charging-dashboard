import {
  Card,
  CardBody,
  CardHeader,
  Code,
  Divider,
  H1,
  H2,
  Row,
  Stack,
  Stat,
  Tag,
  Text,
} from 'qoder/canvas';

export default function MoveStreamingStatusToBottom() {
  return (
    <Stack gap={20}>
      <H1>AI Query Status Indicator Relocation</H1>
      <Text tone="secondary" size="small">
        Moved streaming phase indicator from inside scrollable message area to a fixed bottom bar.
      </Text>

      <Row gap={16}>
        <Stat value="1" label="File Changed" />
        <Stat value="2" label="Code Changes" tone="success" />
        <Stat value="0" label="New i18n Keys" />
      </Row>

      <Divider />

      <H2>Problem</H2>
      <Card>
        <CardBody>
          <Stack gap={12}>
            <Text>
              The streaming phase indicator (spinner + phase label + elapsed time) was rendered
              inside the scrollable message area, at the top of the AI response bubble.
            </Text>
            <Text tone="secondary">
              When users scrolled up to review conversation history, the status bar scrolled out
              of view — they had to manually scroll back to the top to see the current query state.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <H2>Solution</H2>
      <Card>
        <CardHeader title="Layout Change" />
        <CardBody>
          <Stack gap={12}>
            <Row gap={8} align="center">
              <Tag tone="danger">Removed</Tag>
              <Text>Phase indicator from inside AI streaming bubble</Text>
            </Row>
            <Row gap={8} align="center">
              <Tag tone="success">Added</Tag>
              <Text>Fixed status bar between Messages Area and Input Area</Text>
            </Row>
          </Stack>
        </CardBody>
      </Card>

      <H2>Changed File</H2>
      <Card>
        <CardBody>
          <Code>frontend/src/pages/NLQueryPage.tsx</Code>
          <Divider />
          <Stack gap={12}>
            <Text weight="semibold">Change 1 — Delete phase indicator from streaming bubble</Text>
            <Text tone="secondary">
              Removed the entire <Code>{'{querying && streamPhase !== \'idle\' && ...}'}</Code> block
              that rendered Spin + phase label + elapsed time at the top of the AI streaming bubble
              inside the scrollable <Code>overflow-y: auto</Code> container.
            </Text>

            <Text weight="semibold">Change 2 — Add fixed bottom status bar</Text>
            <Text tone="secondary">
              Added a new status bar between the Messages Area closing <Code>&lt;/div&gt;</Code> and
              the Input Area. The bar renders <Code>Spin</Code>, phase text (connecting / thinking /
              executing / error), and elapsed time. Styled with light green background
              and green border, matching the original design.
            </Text>
            <Text tone="secondary">
              The status bar is outside the scrollable container, so it remains fixed at the bottom
              regardless of scroll position. It disappears automatically when the query completes.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <H2>Phase States</H2>
      <Card>
        <CardBody>
          <Row gap={12} wrap>
            <Tag>Connecting</Tag>
            <Tag tone="info">Thinking</Tag>
            <Tag tone="warning">Executing</Tag>
            <Tag tone="danger">Error</Tag>
            <Tag tone="success">Done</Tag>
          </Row>
          <Text tone="secondary" size="small" style={{ marginTop: 8 }}>
            All phase states preserved with i18n support (zh/en).
          </Text>
        </CardBody>
      </Card>

      <H2>Verification</H2>
      <Card>
        <CardBody>
          <Stack gap={8}>
            <Row gap={8} align="center">
              <Tag tone="success">Pass</Tag>
              <Text>Status bar displays at bottom, outside scrollable area</Text>
            </Row>
            <Row gap={8} align="center">
              <Tag tone="success">Pass</Tag>
              <Text>Status remains visible when scrolling message history</Text>
            </Row>
            <Row gap={8} align="center">
              <Tag tone="success">Pass</Tag>
              <Text>Status disappears on query completion / cancel / conversation switch</Text>
            </Row>
            <Row gap={8} align="center">
              <Tag tone="success">Pass</Tag>
              <Text>All phase labels and elapsed time preserved</Text>
            </Row>
          </Stack>
        </CardBody>
      </Card>

      <Text tone="secondary" size="small">
        Completed — spec fully implemented and verified.
      </Text>
    </Stack>
  );
}
