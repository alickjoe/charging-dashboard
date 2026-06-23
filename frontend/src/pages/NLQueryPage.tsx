import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Select, Input, Button, Card, Space, Spin, Alert, Typography,
  Tag, Popconfirm, Empty,
} from 'antd';
import {
  SendOutlined, StopOutlined, BarChartOutlined,
  CodeOutlined, TableOutlined,
  PlusOutlined, DeleteOutlined, MessageOutlined,
} from '@ant-design/icons';
import { fetchConnections } from '../api/connections';
import { fetchLLMConfigs, executeNLQueryStream } from '../api/llm';
import { fetchConversations, fetchConversationDetail, deleteConversation } from '../api/conversations';
import type {
  ConnectionInfo, LLMConfig, SSEEvent,
  Conversation, ConversationDetail, ConversationMessage,
} from '../types';

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

// ─── Block Types ─────────────────────────────────────────────────

type StreamBlockType = 'think' | 'sql' | 'result' | 'error';

interface StreamBlock {
  key: number;
  type: StreamBlockType;
  content: string;
  columns?: string[];
  rows?: unknown[][];
  totalRows?: number;
}

// ─── Markdown Renderer ────────────────────────────────────────────

function RenderMarkdown({ text }: { text: string }) {
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

// ─── Render a single block ────────────────────────────────────────

function BlockView({ block }: { block: StreamBlock }) {
  switch (block.type) {
    case 'think':
      return (
        <div style={{ marginBottom: 16 }}>
          <RenderMarkdown text={block.content} />
        </div>
      );
    case 'sql':
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CodeOutlined style={{ color: '#1890ff' }} />
            <Text strong style={{ fontSize: 13 }}>SQL 查询</Text>
          </div>
          <Paragraph
            copyable
            code
            style={{
              background: '#1e1e1e', color: '#d4d4d4',
              padding: 12, borderRadius: 6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            }}
          >
            {block.content}
          </Paragraph>
        </div>
      );
    case 'result':
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <TableOutlined style={{ color: '#52c41a' }} />
            <Text strong style={{ fontSize: 13 }}>查询结果</Text>
            {block.totalRows !== undefined && <Tag>{block.totalRows} 行</Tag>}
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
          type="warning"
          message={block.content}
          showIcon
          style={{ marginBottom: 16 }}
        />
      );
    default:
      return null;
  }
}

// ─── Parse answer_blocks JSON ─────────────────────────────────────

function parseAnswerBlocks(raw: string): StreamBlock[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((b: Record<string, unknown>, i: number) => ({
      key: i,
      type: (b.type as StreamBlockType) || 'think',
      content: (b.content as string) || '',
      columns: b.columns as string[] | undefined,
      rows: b.rows as unknown[][] | undefined,
      totalRows: b.total_rows as number | undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Page Component ───────────────────────────────────────────────

export default function NLQueryPage() {
  const queryClient = useQueryClient();

  // ── Global selections (for new conversations) ──
  const [selectedConn, setSelectedConn] = useState<string | undefined>();
  const [selectedLLM, setSelectedLLM] = useState<number | undefined>();

  // ── Conversation state ──
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [activeConvMeta, setActiveConvMeta] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);

  // ── Query / streaming state ──
  const [question, setQuestion] = useState('');
  const [querying, setQuerying] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<StreamBlock[]>([]);
  const [streamingThink, setStreamingThink] = useState('');
  const [doneMessage, setDoneMessage] = useState('');
  const [llmTime, setLlmTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blockKeyRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ──
  const { data: connections, isLoading: loadingConns } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  });

  const { data: llmConfigs, isLoading: loadingLLMs } = useQuery({
    queryKey: ['llm-configs'],
    queryFn: fetchLLMConfigs,
  });

  const { data: conversations, isLoading: loadingConvs } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  });

  const availableConns = connections || [];

  // ── Load messages when switching conversations ──
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      setActiveConvMeta(null);
      return;
    }
    fetchConversationDetail(activeConvId).then((detail) => {
      setMessages(detail.messages || []);
      setActiveConvMeta({
        id: detail.id,
        title: detail.title,
        connection_name: detail.connection_name,
        llm_config_id: detail.llm_config_id,
        message_count: detail.messages?.length || 0,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
      });
    }).catch(() => {
      setMessages([]);
    });
  }, [activeConvId]);

  // ── Auto-scroll ──
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingBlocks, streamingThink]);

  // ── Helpers ──
  const resetStreamState = () => {
    setStreamingBlocks([]);
    setStreamingThink('');
    setDoneMessage('');
    setLlmTime(null);
    setError(null);
    blockKeyRef.current = 0;
  };

  const flushThink = useCallback((text: string) => {
    if (!text.trim()) return;
    setStreamingBlocks((prev) => [
      ...prev,
      { key: blockKeyRef.current++, type: 'think', content: text },
    ]);
    setStreamingThink('');
  }, []);

  const handleSend = () => {
    const conn = activeConvMeta?.connection_name || selectedConn;
    const llmId = activeConvMeta?.llm_config_id || selectedLLM;
    if (!conn || !llmId || !question.trim()) return;

    setQuerying(true);
    resetStreamState();

    abortRef.current = executeNLQueryStream(
      {
        connection_name: conn,
        llm_config_id: llmId,
        question: question.trim(),
        conversation_id: activeConvId ?? undefined,
      },
      (event: SSEEvent) => {
        switch (event.type) {
          case 'think':
            setStreamingThink((prev) => prev + (event.content || ''));
            break;
          case 'sql':
            setStreamingThink((prev) => {
              if (prev.trim()) {
                setStreamingBlocks((b) => [
                  ...b,
                  { key: blockKeyRef.current++, type: 'think', content: prev },
                ]);
              }
              return '';
            });
            setStreamingBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'sql', content: event.content || '' },
            ]);
            break;
          case 'result':
            setStreamingBlocks((prev) => [
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
            setStreamingBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'error', content: event.message || '' },
            ]);
            break;
          case 'done':
            setStreamingThink((prev) => {
              if (prev.trim()) {
                setStreamingBlocks((b) => [
                  ...b,
                  { key: blockKeyRef.current++, type: 'think', content: prev },
                ]);
              }
              return '';
            });
            setDoneMessage(event.message || '');
            if (event.llm_time_ms) setLlmTime(event.llm_time_ms);
            // Set active conversation from done event
            if (event.conversation_id && !activeConvId) {
              setActiveConvId(event.conversation_id);
            }
            break;
        }
      },
      (err: string) => {
        setError(err);
      },
      () => {
        setQuerying(false);
        // Refresh conversation list after query completes
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
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

  const handleNewChat = () => {
    // Cancel any ongoing query
    abortRef.current?.abort();
    setQuerying(false);
    setActiveConvId(null);
    setActiveConvMeta(null);
    setMessages([]);
    resetStreamState();
    setQuestion('');
  };

  const handleSelectConv = (conv: Conversation) => {
    if (querying) {
      abortRef.current?.abort();
      setQuerying(false);
    }
    setActiveConvId(conv.id);
    resetStreamState();
    setQuestion('');
  };

  const handleDeleteConv = async (id: number) => {
    await deleteConversation(id);
    if (activeConvId === id) {
      setActiveConvId(null);
      setActiveConvMeta(null);
      setMessages([]);
      resetStreamState();
    }
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  // ── Format time ──
  const fmtTime = (ts: string) => {
    try {
      const d = new Date(ts + 'Z');
      return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  // ── Determine if we can send ──
  const conn = activeConvMeta?.connection_name || selectedConn;
  const llmId = activeConvMeta?.llm_config_id || selectedLLM;
  const canSend = !!conn && !!llmId && !!question.trim() && !querying;

  // ── Conversation info for header ──
  const connLabel = availableConns.find((c) => c.name === conn)?.label || conn || '';
  const llmName = (llmConfigs || []).find((c) => c.id === llmId)?.name || '';

  // ── Merge historic + streaming messages for display ──
  const displayMessages = [...messages];

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 140px)', gap: 0 }}>
      {/* ─── Left Sidebar: Conversation List ─── */}
      <div style={{
        width: 300, minWidth: 300,
        borderRight: '1px solid #f0f0f0',
        display: 'flex', flexDirection: 'column',
        background: '#fafafa',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={handleNewChat}
          >
            新建会话
          </Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loadingConvs ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin />
            </div>
          ) : (conversations || []).length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无会话"
              style={{ marginTop: 32 }}
            />
          ) : (
            (conversations || []).map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: activeConvId === conv.id ? '#e6f4ff' : 'transparent',
                  borderLeft: activeConvId === conv.id ? '3px solid #1890ff' : '3px solid transparent',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (activeConvId !== conv.id)
                    (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                }}
                onMouseLeave={(e) => {
                  if (activeConvId !== conv.id)
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 500, fontSize: 14,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      <MessageOutlined style={{ marginRight: 6, color: '#999' }} />
                      {conv.title || '新会话'}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                      {conv.message_count} 条消息 · {fmtTime(conv.updated_at)}
                    </div>
                  </div>
                  <Popconfirm
                    title="确定删除此会话？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDeleteConv(conv.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flexShrink: 0, marginLeft: 4 }}
                    />
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── Right Area: Chat View ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: '12px 24px', borderBottom: '1px solid #f0f0f0',
          background: '#fff', display: 'flex', alignItems: 'center', gap: 16,
        }}>
          {activeConvMeta ? (
            <>
              <Text strong style={{ fontSize: 15 }}>{activeConvMeta.title || '新会话'}</Text>
              <Tag>{connLabel}</Tag>
              <Tag color="blue">{llmName}</Tag>
            </>
          ) : (
            <>
              <Text strong style={{ fontSize: 15 }}>新建会话</Text>
              <Space wrap>
                <span style={{ fontSize: 13, color: '#666' }}>数据库：</span>
                <Select
                  placeholder="选择数据库连接"
                  value={selectedConn}
                  onChange={(v) => setSelectedConn(v)}
                  loading={loadingConns}
                  style={{ minWidth: 220 }}
                  options={availableConns.map((c: ConnectionInfo) => ({
                    value: c.name,
                    label: `${c.label} (${c.database})`,
                  }))}
                  notFoundContent={loadingConns ? <Spin size="small" /> : '无可用连接'}
                />
                <span style={{ fontSize: 13, color: '#666' }}>AI 模型：</span>
                <Select
                  placeholder="选择 AI 模型"
                  value={selectedLLM}
                  onChange={(v) => setSelectedLLM(v)}
                  loading={loadingLLMs}
                  style={{ minWidth: 180 }}
                  options={(llmConfigs || []).map((c: LLMConfig) => ({
                    value: c.id,
                    label: `${c.name} (${c.model})`,
                  }))}
                  notFoundContent={loadingLLMs ? <Spin size="small" /> : '无 LLM 配置'}
                />
              </Space>
            </>
          )}
        </div>

        {/* Messages Area */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 24px',
          background: '#f5f5f5',
        }}>
          {displayMessages.length === 0 && !querying && !error && (
            <div style={{
              textAlign: 'center', paddingTop: 80, color: '#bbb',
            }}>
              <BarChartOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <div style={{ fontSize: 16 }}>
                {activeConvId
                  ? '在下方输入问题开始对话'
                  : '选择数据库和 AI 模型，然后输入问题开始查询'}
              </div>
            </div>
          )}

          {error && (
            <Alert
              type="error"
              message="查询失败"
              description={error}
              showIcon
              closable
              style={{ marginBottom: 16 }}
              onClose={() => setError(null)}
            />
          )}

          {/* Historic messages */}
          {displayMessages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 20 }}>
              {/* User message */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <div style={{
                  maxWidth: '75%',
                  background: '#1890ff', color: '#fff',
                  borderRadius: '12px 12px 4px 12px',
                  padding: '10px 16px',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {msg.question}
                </div>
              </div>

              {/* Assistant message */}
              {msg.role === 'assistant' && parseAnswerBlocks(msg.answer_blocks).length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%',
                    background: '#fff',
                    borderRadius: '12px 12px 12px 4px',
                    padding: '12px 16px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }}>
                    {parseAnswerBlocks(msg.answer_blocks).map((block) => (
                      <BlockView key={block.key} block={block} />
                    ))}
                    {msg.llm_time_ms && (
                      <Tag color="blue" style={{ marginTop: 4 }}>LLM 耗时: {msg.llm_time_ms}ms</Tag>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Streaming response (in-progress) */}
          {(streamingBlocks.length > 0 || streamingThink || querying) && (
            <div style={{ marginBottom: 20 }}>
              {/* User question bubble for streaming */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <div style={{
                  maxWidth: '75%',
                  background: '#1890ff', color: '#fff',
                  borderRadius: '12px 12px 4px 12px',
                  padding: '10px 16px',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {question}
                </div>
              </div>

              {/* AI streaming bubble */}
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  maxWidth: '85%',
                  background: '#fff',
                  borderRadius: '12px 12px 12px 4px',
                  padding: '12px 16px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                }}>
                  {streamingBlocks.map((block) => (
                    <BlockView key={block.key} block={block} />
                  ))}

                  {streamingThink && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Spin size="small" />
                        <Text type="secondary" style={{ fontSize: 13 }}>思考中...</Text>
                      </div>
                      <RenderMarkdown text={streamingThink} />
                    </div>
                  )}

                  {querying && streamingBlocks.length === 0 && !streamingThink && (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                      <Spin size="small" tip="AI 正在思考……" />
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

                  {llmTime && (
                    <Tag color="blue" style={{ marginTop: 4 }}>LLM 耗时: {llmTime}ms</Tag>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid #f0f0f0',
          background: '#fff',
        }}>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              placeholder={
                activeConvId
                  ? '继续输入问题... (Enter 发送，Shift+Enter 换行)'
                  : '用自然语言描述你想查询的数据...'
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              disabled={querying}
              onPressEnter={(e) => {
                if (!e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={querying ? <StopOutlined /> : <SendOutlined />}
              onClick={querying ? handleStop : handleSend}
              danger={querying}
              disabled={!querying && !canSend}
              style={{ height: 'auto', minHeight: 52 }}
            >
              {querying ? '停止' : '发送'}
            </Button>
          </Space.Compact>
        </div>
      </div>
    </div>
  );
}
