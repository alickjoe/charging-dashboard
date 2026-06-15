import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Select, Input, Button, Card, Space, Spin, Alert, Typography,
  Tag,
} from 'antd';
import {
  SendOutlined, StopOutlined, BarChartOutlined,
  CodeOutlined, TableOutlined,
} from '@ant-design/icons';
import { fetchConnections } from '../api/connections';
import { fetchLLMConfigs, executeNLQueryStream } from '../api/llm';
import type { ConnectionInfo, LLMConfig, SSEEvent } from '../types';

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

// ─── Block Types ─────────────────────────────────────────────────

type StreamBlockType = 'think' | 'sql' | 'result' | 'error';

interface StreamBlock {
  key: number;
  type: StreamBlockType;
  content: string;       // think text / sql string / error message
  columns?: string[];
  rows?: unknown[][];
  totalRows?: number;
}

// ─── Markdown Renderer ────────────────────────────────────────────

function RenderMarkdown({ text }: { text: string }) {
  // Simple markdown: **bold**, `code`, line breaks
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\n)/g);
  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (part === '\n') return <br key={i} />;
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <Text key={i} code>{part.slice(1, -1)}</Text>;
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

// ─── Mini Result Table ────────────────────────────────────────────

function MiniResultTable({ columns, rows, totalRows }: {
  columns: string[];
  rows: unknown[][];
  totalRows?: number;
}) {
  if (!columns.length) return <Text type="secondary">查询无结果</Text>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse', width: '100%',
          fontSize: 13, fontFamily: 'monospace',
        }}
      >
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {columns.map((col) => (
              <th key={col} style={{
                border: '1px solid #ddd', padding: '4px 8px',
                textAlign: 'left', fontWeight: 600,
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((val, ci) => (
                <td key={ci} style={{
                  border: '1px solid #eee', padding: '2px 8px',
                  maxWidth: 300, overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {val === null ? (
                    <span style={{ color: '#aaa' }}>NULL</span>
                  ) : String(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalRows !== undefined && totalRows > rows.length && (
        <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
          显示前 {rows.length} 行，共 {totalRows} 行
        </Text>
      )}
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────

export default function NLQueryPage() {
  const [selectedConn, setSelectedConn] = useState<string | undefined>();
  const [selectedLLM, setSelectedLLM] = useState<number | undefined>();
  const [question, setQuestion] = useState('');
  const [querying, setQuerying] = useState(false);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [streamingThink, setStreamingThink] = useState('');
  const [doneMessage, setDoneMessage] = useState('');
  const [llmTime, setLlmTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blockKeyRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const { data: connections, isLoading: loadingConns } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 60000,
  });

  const { data: llmConfigs, isLoading: loadingLLMs } = useQuery({
    queryKey: ['llm-configs'],
    queryFn: fetchLLMConfigs,
  });

  const connectedConns = (connections || []).filter(
    (c: ConnectionInfo) => c.status === 'connected'
  );

  const flushThink = useCallback((text: string) => {
    if (!text.trim()) return;
    setBlocks((prev) => [
      ...prev,
      { key: blockKeyRef.current++, type: 'think', content: text },
    ]);
    setStreamingThink('');
  }, []);

  const handleQuery = () => {
    if (!selectedConn || !selectedLLM || !question.trim()) return;

    // Reset state
    setQuerying(true);
    setBlocks([]);
    setStreamingThink('');
    setDoneMessage('');
    setLlmTime(null);
    setError(null);

    abortRef.current = executeNLQueryStream(
      {
        connection_name: selectedConn,
        llm_config_id: selectedLLM,
        question: question.trim(),
      },
      (event: SSEEvent) => {
        switch (event.type) {
          case 'think':
            // Flush any pending think block, then stream new text
            // We accumulate think text inline via streamingThink state
            setStreamingThink((prev) => {
              // If previous was empty, this is a new think block
              return prev + (event.content || '');
            });
            break;

          case 'sql':
            // Flush pending think block before showing SQL
            setStreamingThink((prev) => {
              if (prev.trim()) {
                setBlocks((b) => [
                  ...b,
                  { key: blockKeyRef.current++, type: 'think', content: prev },
                ]);
              }
              return '';
            });
            setBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'sql', content: event.content || '' },
            ]);
            break;

          case 'result':
            setBlocks((prev) => [
              ...prev,
              {
                key: blockKeyRef.current++,
                type: 'result',
                content: '',
                columns: event.columns,
                rows: event.rows,
                totalRows: event.total_rows,
              },
            ]);
            break;

          case 'error':
            setBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'error', content: event.message || '' },
            ]);
            break;

          case 'done':
            setStreamingThink((prev) => {
              if (prev.trim()) {
                setBlocks((b) => [
                  ...b,
                  { key: blockKeyRef.current++, type: 'think', content: prev },
                ]);
              }
              return '';
            });
            setDoneMessage(event.message || '');
            if (event.llm_time_ms) setLlmTime(event.llm_time_ms);
            break;
        }
      },
      (err: string) => {
        setError(err);
      },
      () => {
        setQuerying(false);
      },
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setQuerying(false);
    if (streamingThink.trim()) {
      flushThink(streamingThink);
    }
  };

  // Flush streaming think when done
  const hasOutput = blocks.length > 0 || streamingThink || doneMessage;

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>AI 自然语言查询</h2>

      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <span style={{ fontWeight: 500 }}>数据库：</span>
            <Select
              placeholder="选择数据库连接"
              value={selectedConn}
              onChange={(v) => setSelectedConn(v)}
              loading={loadingConns}
              disabled={querying}
              style={{ minWidth: 280 }}
              options={connectedConns.map((c: ConnectionInfo) => ({
                value: c.name,
                label: `${c.label} (${c.database})`,
              }))}
              notFoundContent={loadingConns ? <Spin size="small" /> : '无可用连接'}
            />
            <span style={{ fontWeight: 500, marginLeft: 16 }}>AI 模型：</span>
            <Select
              placeholder="选择 AI 模型"
              value={selectedLLM}
              onChange={(v) => setSelectedLLM(v)}
              loading={loadingLLMs}
              disabled={querying}
              style={{ minWidth: 200 }}
              options={(llmConfigs || []).map((c: LLMConfig) => ({
                value: c.id,
                label: `${c.name} (${c.model})`,
              }))}
              notFoundContent={loadingLLMs ? <Spin size="small" /> : '无 LLM 配置'}
            />
          </Space>

          <TextArea
            placeholder="用自然语言描述你想查询的数据，例如：分析roaming schema下各表之间的关系"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            disabled={querying}
            onPressEnter={(e) => {
              if (!e.shiftKey) { e.preventDefault(); handleQuery(); }
            }}
          />

          <Space>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleQuery}
              loading={querying}
              disabled={!selectedConn || !selectedLLM || !question.trim()}
            >
              查询
            </Button>
            {querying && (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
              >
                停止
              </Button>
            )}
          </Space>
        </Space>
      </Card>

      {error && (
        <Alert
          type="error"
          message="查询失败"
          description={error}
          showIcon
          style={{ marginBottom: 24 }}
          closable
        />
      )}

      {querying && !hasOutput && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip="AI 正在思考……" />
        </div>
      )}

      {hasOutput && (
        <Card
          title={
            <Space>
              <BarChartOutlined />
              <span>分析过程</span>
              {llmTime && (
                <Tag color="blue">LLM 耗时: {llmTime}ms</Tag>
              )}
            </Space>
          }
        >
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {blocks.map((block) => {
              switch (block.type) {
                case 'think':
                  return (
                    <div key={block.key} style={{ marginBottom: 20 }}>
                      <RenderMarkdown text={block.content} />
                    </div>
                  );

                case 'sql':
                  return (
                    <div key={block.key} style={{ marginBottom: 20 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
                      }}>
                        <CodeOutlined style={{ color: '#1890ff' }} />
                        <Text strong style={{ fontSize: 13 }}>SQL 查询</Text>
                      </div>
                      <Paragraph
                        copyable
                        code
                        style={{
                          background: '#1e1e1e',
                          color: '#d4d4d4',
                          padding: 12,
                          borderRadius: 6,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          margin: 0,
                        }}
                      >
                        {block.content}
                      </Paragraph>
                    </div>
                  );

                case 'result':
                  return (
                    <div key={block.key} style={{ marginBottom: 20 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
                      }}>
                        <TableOutlined style={{ color: '#52c41a' }} />
                        <Text strong style={{ fontSize: 13 }}>查询结果</Text>
                        {block.totalRows !== undefined && (
                          <Tag>{block.totalRows} 行</Tag>
                        )}
                      </div>
                      <MiniResultTable
                        columns={block.columns || []}
                        rows={block.rows || []}
                        totalRows={block.totalRows}
                      />
                    </div>
                  );

                case 'error':
                  return (
                    <Alert
                      key={block.key}
                      type="warning"
                      message={block.content}
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                  );

                default:
                  return null;
              }
            })}

            {/* Streaming think text */}
            {streamingThink && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
                }}>
                  <Spin size="small" />
                  <Text type="secondary" style={{ fontSize: 13 }}>思考中...</Text>
                </div>
                <RenderMarkdown text={streamingThink} />
              </div>
            )}

            {querying && hasOutput && (
              <div style={{ textAlign: 'center', padding: 12 }}>
                <Spin size="small" />
              </div>
            )}

            {doneMessage && !querying && (
              <Alert
                type="success"
                message="分析完成"
                description={doneMessage}
                showIcon
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
