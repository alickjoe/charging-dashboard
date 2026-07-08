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
import { fetchSkills } from '../api/skills';
import type {
  ConnectionInfo, LLMConfig, SSEEvent,
  Conversation, ConversationDetail, ConversationMessage,
  Skill,
} from '../types';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../i18n/store';

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

// ─── Markdown Helpers ────────────────────────────────────────────

/** Check if a line is a markdown table separator row (e.g. |---|---| for multi-column) */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  // Match single or multi-column separators: |---|, |---|---|, |:---|:---:|---|
  return /^\|[-: ]+(\|[-: ]+)*\|$/.test(trimmed) && trimmed.includes('-');
}

/** Parse a table row into cell values, stripping leading/trailing pipes */
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim());
}

/** Find the end line of a table block starting at `start`. Returns `start` if not a valid table. */
function findTableEnd(lines: string[], start: number): number {
  let end = start;
  while (
    end < lines.length &&
    lines[end].trimStart().startsWith('|') &&
    lines[end].trimEnd().endsWith('|')
  ) {
    end++;
  }
  if (end - start >= 2 && isTableSeparator(lines[start + 1])) {
    return end;
  }
  return start;
}

// ─── Markdown Renderer with Table Support ─────────────────────────

function RenderMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null;

  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if current line could start a table
    const curLine = lines[i];
    if (curLine.trimStart().startsWith('|') && curLine.trimEnd().endsWith('|')) {
      const tableEnd = findTableEnd(lines, i);
      if (tableEnd > i) {
        // Valid markdown table found
        const headers = parseTableRow(lines[i]);
        const dataRows = lines.slice(i + 2, tableEnd).map(parseTableRow);
        const maxCols = Math.max(headers.length, ...dataRows.map(r => r.length));

        nodes.push(
          <div key={`tbl-${i}`} style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{
              borderCollapse: 'collapse', width: '100%',
              fontSize: 13, fontFamily: 'monospace',
            }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  {Array.from({ length: maxCols }).map((_, ci) => (
                    <th key={ci} style={{
                      border: '1px solid #ddd', padding: '4px 8px',
                      textAlign: 'left', fontWeight: 600,
                    }}>
                      {headers[ci] || ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: maxCols }).map((_, ci) => (
                      <td key={ci} style={{
                        border: '1px solid #eee', padding: '2px 8px',
                        maxWidth: 300, overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {row[ci] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

        i = tableEnd;
        continue;
      }
    }

    // Not a table — collect consecutive non-table lines as a text block
    const textStart = i;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trimStart().startsWith('|') && l.trimEnd().endsWith('|')) {
        const peek = findTableEnd(lines, i);
        if (peek > i) break; // Next line starts a table
      }
      i++;
    }

    const textBlock = lines.slice(textStart, i).join('\n');
    if (textBlock.trim()) {
      const parts = textBlock.split(/(\*\*.*?\*\*|`.*?`|\n)/g);
      nodes.push(
        <div key={`txt-${textStart}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {parts.map((part, pi) => {
            if (part === '\n') return <br key={pi} />;
            if (part.startsWith('**') && part.endsWith('**'))
              return <strong key={pi}>{part.slice(2, -2)}</strong>;
            if (part.startsWith('`') && part.endsWith('`'))
              return <Text key={pi} code>{part.slice(1, -1)}</Text>;
            return <span key={pi}>{part}</span>;
          })}
        </div>
      );
    }
  }

  return <div>{nodes}</div>;
}

// ─── Mini Result Table ────────────────────────────────────────────

function MiniResultTable({ columns, rows, totalRows }: {
  columns: string[];
  rows: unknown[][];
  totalRows?: number;
}) {
  const { t } = useTranslation();
  if (!columns.length) return <Text type="secondary">{t('chat.noResults')}</Text>;
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
          {t('chat.showingRows', { shown: rows.length, total: totalRows })}
        </Text>
      )}
    </div>
  );
}

// ─── Render a single block ────────────────────────────────────────

function BlockView({ block }: { block: StreamBlock }) {
  const { t } = useTranslation();
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
            <Text strong style={{ fontSize: 13 }}>{t('block.sqlQuery')}</Text>
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
            <Text strong style={{ fontSize: 13 }}>{t('block.queryResult')}</Text>
            {block.totalRows !== undefined && <Tag>{t('block.rows', { count: block.totalRows })}</Tag>}
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
    // Merge consecutive think blocks to handle fragmented history data
    const merged: StreamBlock[] = [];
    for (const b of arr) {
      const blockType = (b.type as StreamBlockType) || 'think';
      if (blockType === 'think' && merged.length > 0 && merged[merged.length - 1].type === 'think') {
        merged[merged.length - 1].content += (b.content as string) || '';
      } else {
        merged.push({
          key: merged.length,
          type: blockType,
          content: (b.content as string) || '',
          columns: b.columns as string[] | undefined,
          rows: b.rows as unknown[][] | undefined,
          totalRows: b.total_rows as number | undefined,
        });
      }
    }
    return merged;
  } catch {
    return [];
  }
}

// ─── Page Component ───────────────────────────────────────────────

export default function NLQueryPage() {
  const { t, i18n } = useTranslation();
  const language = useLanguageStore((s) => s.language);
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

  // ── Skill selection ──
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

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

  const { data: skills } = useQuery({
    queryKey: ['skills'],
    queryFn: fetchSkills,
  });

  const availableConns = connections || [];

  // ── Load messages when switching conversations ──
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      setActiveConvMeta(null);
      return;
    }
    let cancelled = false;
    fetchConversationDetail(activeConvId).then((detail) => {
      if (cancelled) return;
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
      // Clear streaming state now that DB messages are loaded
      setStreamingBlocks([]);
      setStreamingThink('');
      setDoneMessage('');
      setLlmTime(null);
      setError(null);
      blockKeyRef.current = 0;
    }).catch(() => {
      if (!cancelled) setMessages([]);
    });
    return () => { cancelled = true; };
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

    // Build effective question: user's input, or fall back to selected skills' templates
    let effectiveQuestion = question.trim();
    if (!effectiveQuestion && selectedSkillIds.length > 0) {
      const skillList = skills || [];
      effectiveQuestion = skillList
        .filter((s) => selectedSkillIds.includes(s.id) && s.user_prompt_template?.trim())
        .map((s) => s.user_prompt_template!)
        .join('\n\n');
    }

    if (!conn || !llmId || !effectiveQuestion) return;

    setQuerying(true);
    resetStreamState();

    abortRef.current = executeNLQueryStream(
      {
        connection_name: conn,
        llm_config_id: llmId,
        question: effectiveQuestion,
        conversation_id: activeConvId ?? undefined,
        language: language,
        skill_ids: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
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
    setSelectedSkillIds([]);
    setShowSkillPicker(false);
    setSlashFilter('');
  };

  const handleSelectConv = (conv: Conversation) => {
    if (querying) {
      abortRef.current?.abort();
      setQuerying(false);
    }
    setActiveConvId(conv.id);
    setMessages([]);
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
      return d.toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  // ── Determine if we can send ──
  const conn = activeConvMeta?.connection_name || selectedConn;
  const llmId = activeConvMeta?.llm_config_id || selectedLLM;
  const skillQuestion = selectedSkillIds.length > 0
    ? (skills || [])
        .filter((s) => selectedSkillIds.includes(s.id) && s.user_prompt_template?.trim())
        .map((s) => s.user_prompt_template!)
        .join('\n\n')
    : '';
  const effectiveQuestion = question.trim() || skillQuestion;
  const canSend = !!conn && !!llmId && !!effectiveQuestion && !querying;

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
            {t('chat.newChat')}
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
              description={t('chat.noConversations')}
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
                      {conv.title || t('chat.newConversation')}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                      {t('chat.messages', { count: conv.message_count })} · {fmtTime(conv.updated_at)}
                    </div>
                  </div>
                  <Popconfirm
                    title={t('chat.deleteConfirm')}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDeleteConv(conv.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText={t('common.delete')}
                    cancelText={t('common.cancel')}
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
              <Text strong style={{ fontSize: 15 }}>{activeConvMeta.title || t('chat.newConversation')}</Text>
              <Tag>{connLabel}</Tag>
              <Tag color="blue">{llmName}</Tag>
            </>
          ) : (
            <>
              <Text strong style={{ fontSize: 15 }}>{t('chat.newSession')}</Text>
              <Space wrap>
                <span style={{ fontSize: 13, color: '#666' }}>{t('chat.dbLabel')}</span>
                <Select
                  placeholder={t('chat.selectDB')}
                  value={selectedConn}
                  onChange={(v) => setSelectedConn(v)}
                  loading={loadingConns}
                  style={{ minWidth: 220 }}
                  options={availableConns.map((c: ConnectionInfo) => ({
                    value: c.name,
                    label: `${c.label} (${c.database})`,
                  }))}
                  notFoundContent={loadingConns ? <Spin size="small" /> : t('chat.noConnections')}
                />
                <span style={{ fontSize: 13, color: '#666' }}>{t('chat.aiModelLabel')}</span>
                <Select
                  placeholder={t('chat.selectModel')}
                  value={selectedLLM}
                  onChange={(v) => setSelectedLLM(v)}
                  loading={loadingLLMs}
                  style={{ minWidth: 180 }}
                  options={(llmConfigs || []).map((c: LLMConfig) => ({
                    value: c.id,
                    label: `${c.name} (${c.model})`,
                  }))}
                  notFoundContent={loadingLLMs ? <Spin size="small" /> : t('chat.noLLMConfigs')}
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
                  ? t('chat.emptyContinue')
                  : t('chat.emptyNew')}
              </div>
            </div>
          )}

          {error && (
            <Alert
              type="error"
              message={t('chat.queryFailed')}
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
                    overflowX: 'auto',
                    minWidth: 0,
                  }}>
                    {parseAnswerBlocks(msg.answer_blocks).map((block) => (
                      <BlockView key={block.key} block={block} />
                    ))}
                    {msg.llm_time_ms && (
                      <Tag color="blue" style={{ marginTop: 4 }}>{t('chat.llmTime', { time: msg.llm_time_ms })}</Tag>
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
                  overflowX: 'auto',
                  minWidth: 0,
                }}>
                  {streamingBlocks.map((block) => (
                    <BlockView key={block.key} block={block} />
                  ))}

                  {streamingThink && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Spin size="small" />
                        <Text type="secondary" style={{ fontSize: 13 }}>{t('block.thinking')}</Text>
                      </div>
                      <RenderMarkdown text={streamingThink} />
                    </div>
                  )}

                  {querying && streamingBlocks.length === 0 && !streamingThink && (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                      <Spin size="small" tip={t('block.aiThinking')} />
                    </div>
                  )}

                  {doneMessage && !querying && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ marginBottom: 4 }}>
                        <Tag color="success">{t('block.analysisDone')}</Tag>
                      </div>
                      <RenderMarkdown text={doneMessage} />
                    </div>
                  )}

                  {llmTime && (
                    <Tag color="blue" style={{ marginTop: 4 }}>{t('chat.llmTime', { time: llmTime })}</Tag>
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
          {/* Skill selector bar */}
          {(skills || []).length > 0 && (
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {(skills || []).filter(s => selectedSkillIds.includes(s.id)).map((skill) => (
                <Tag
                  key={skill.id}
                  closable
                  onClose={() => setSelectedSkillIds(prev => prev.filter(id => id !== skill.id))}
                  color="purple"
                >
                  /{skill.name}
                </Tag>
              ))}
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setShowSkillPicker(!showSkillPicker)}
              >
                {t('skills.addSkill')}
              </Button>
            </div>
          )}

          {/* Skill picker dropdown */}
          {showSkillPicker && (
            <div style={{
              marginBottom: 8, padding: 8,
              border: '1px solid #d9d9d9', borderRadius: 6,
              background: '#fff', maxHeight: 200, overflowY: 'auto',
            }}>
              {(skills || [])
                .filter(s => !selectedSkillIds.includes(s.id))
                .filter(s => !slashFilter || s.name.toLowerCase().includes(slashFilter.toLowerCase()))
                .map((skill) => (
                  <div
                    key={skill.id}
                    onClick={() => {
                      setSelectedSkillIds(prev => [...prev, skill.id]);
                      setShowSkillPicker(false);
                      setSlashFilter('');
                    }}
                    style={{
                      padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#f5f5f5'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <Tag color="purple" style={{ margin: 0 }}>/{skill.name}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{skill.description}</Text>
                  </div>
                ))}
              {(skills || []).filter(s => !selectedSkillIds.includes(s.id)).length === 0 && (
                <Text type="secondary" style={{ padding: 8 }}>{t('skills.noMoreSkills')}</Text>
              )}
            </div>
          )}

          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              placeholder={
                activeConvId
                  ? t('chat.placeholderContinue')
                  : t('chat.placeholderNew')
              }
              value={question}
              onChange={(e) => {
                const val = e.target.value;
                setQuestion(val);
                // Detect / typing for skill autocomplete
                const slashMatch = val.match(/^\/(\w*)$/);
                if (slashMatch && (skills || []).length > 0) {
                  setShowSkillPicker(true);
                  setSlashFilter(slashMatch[1] || '');
                } else if (!val.startsWith('/')) {
                  setSlashFilter('');
                }
              }}
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
              {querying ? t('chat.stop') : t('chat.send')}
            </Button>
          </Space.Compact>
        </div>
      </div>
    </div>
  );
}
