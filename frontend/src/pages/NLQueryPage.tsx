import { useState, useRef, useCallback, useEffect, memo, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Select, Input, Button, Card, Space, Spin, Alert, Typography,
  Tag, Popconfirm, Empty,
} from 'antd';
import {
  SendOutlined, StopOutlined, BarChartOutlined,
  CodeOutlined, TableOutlined,
  PlusOutlined, DeleteOutlined, MessageOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons';
import { fetchConnections } from '../api/connections';
import { fetchSchemas } from '../api/databases';
import { fetchLLMConfigs, executeNLQueryStream } from '../api/llm';
import { fetchConversations, fetchConversationDetail, deleteConversation } from '../api/conversations';
import { fetchSkills } from '../api/skills';
import MarkdownRenderer from '../components/Markdown';
import type {
  ConnectionInfo, ConnectionSchemaSelection, LLMConfig, SSEEvent,
  Conversation, ConversationDetail, ConversationMessage,
  Skill,
} from '../types';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../i18n/store';

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

// ─── Phase & Block Types ─────────────────────────────────────────

type StreamPhase = 'idle' | 'connecting' | 'thinking' | 'executing' | 'done' | 'error';

type StreamBlockType = 'think' | 'sql' | 'result' | 'error' | 'summary';

interface StreamBlock {
  key: number;
  type: StreamBlockType;
  content: string;
  columns?: string[];
  rows?: unknown[][];
  totalRows?: number;
}

// ─── Markdown rendering is delegated to <MarkdownRenderer /> ─────

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
          <MarkdownRenderer text={block.content} />
        </div>
      );
    case 'summary':
      // Final conclusion — shown exactly once (deduplicated against think blocks)
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <Tag color="success">{t('block.analysisDone')}</Tag>
          </div>
          <MarkdownRenderer text={block.content} />
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

const MemoBlockView = memo(BlockView);

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
  const [selectedConns, setSelectedConns] = useState<string[]>([]);
  const [schemaFilters, setSchemaFilters] = useState<Record<string, string[]>>({});
  const [schemasMap, setSchemasMap] = useState<Record<string, string[]>>({});
  const [schemasLoading, setSchemasLoading] = useState<Record<string, boolean>>({});
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
  const [llmTime, setLlmTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const blockKeyRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Throttle refs for smooth streaming
  const thinkBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  // ── Skill selection ──
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  // Sidebar toggle for responsive layout
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => setSidebarVisible(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // ── Load schema lists for selected connections (for schema filtering) ──
  useEffect(() => {
    selectedConns.forEach((connName) => {
      if (schemasMap[connName] !== undefined) return;
      setSchemasLoading((prev) => ({ ...prev, [connName]: true }));
      fetchSchemas(connName)
        .then((schemas) => {
          setSchemasMap((prev) => ({ ...prev, [connName]: schemas }));
        })
        .catch(() => {
          setSchemasMap((prev) => ({ ...prev, [connName]: [] }));
        })
        .finally(() => {
          setSchemasLoading((prev) => ({ ...prev, [connName]: false }));
        });
    });
  }, [selectedConns, schemasMap]);

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
        connection_schemas: detail.connection_schemas || [],
        message_count: detail.messages?.length || 0,
        skill_ids: detail.skill_ids || [],
        created_at: detail.created_at,
        updated_at: detail.updated_at,
      });
      // Clear streaming state now that DB messages are loaded
      setStreamingBlocks([]);
      setStreamingThink('');
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
    setLlmTime(null);
    setError(null);
    setStreamPhase('idle');
    setElapsedSeconds(0);
    blockKeyRef.current = 0;
    thinkBufferRef.current = '';
  };

  // ── Flush / Timer helpers ──
  const startFlushTimer = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      const buf = thinkBufferRef.current;
      if (buf) {
        thinkBufferRef.current = '';
        setStreamingThink((prev) => prev + buf);
      }
    }, 50);
  }, []);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Flush any remaining buffer
    const buf = thinkBufferRef.current;
    if (buf) {
      thinkBufferRef.current = '';
      setStreamingThink((prev) => prev + buf);
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((Date.now() - startTimeRef.current) / 1000);
    }, 200);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const handleSend = () => {
    // Effective connection selections: conversation-bound or global multi-select
    let connSelections: ConnectionSchemaSelection[];
    if (activeConvMeta) {
      connSelections = activeConvMeta.connection_schemas?.length
        ? activeConvMeta.connection_schemas
        : [{ connection_name: activeConvMeta.connection_name, schemas: [] }];
    } else {
      connSelections = selectedConns.map((c) => ({
        connection_name: c,
        schemas: schemaFilters[c] || [],
      }));
    }
    const conn = connSelections[0]?.connection_name;
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
    setStreamPhase('connecting');
    startFlushTimer();
    startElapsedTimer();

    // Helper to flush think buffer into streamingBlocks before phase change.
    // `trimTail` removes the final conclusion from the pending think content
    // (the conclusion is rendered once as a dedicated 'summary' block instead).
    const flushBufferToBlocks = (trimTail?: string) => {
      const buf = thinkBufferRef.current;
      thinkBufferRef.current = '';
      setStreamingThink((prev) => {
        let combined = prev + buf;
        const tail = trimTail?.trimEnd();
        if (tail) {
          const trimmed = combined.trimEnd();
          if (trimmed.endsWith(tail)) {
            combined = trimmed.slice(0, trimmed.length - tail.length).trimEnd();
          }
        }
        if (combined.trim()) {
          setStreamingBlocks((b) => [
            ...b,
            { key: blockKeyRef.current++, type: 'think', content: combined },
          ]);
        }
        return '';
      });
    };

    abortRef.current = executeNLQueryStream(
      {
        connection_name: conn,
        connection_schemas: connSelections,
        llm_config_id: llmId,
        question: effectiveQuestion,
        conversation_id: activeConvId ?? undefined,
        language: language,
        skill_ids: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
      },
      (event: SSEEvent) => {
        switch (event.type) {
          case 'think':
            setStreamPhase('thinking');
            thinkBufferRef.current += (event.content || '');
            break;
          case 'sql':
            setStreamPhase('executing');
            flushBufferToBlocks();
            setStreamingBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'sql', content: event.content || '' },
            ]);
            break;
          case 'result':
            setStreamPhase('executing');
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
            setStreamPhase('error');
            setStreamingBlocks((prev) => [
              ...prev,
              { key: blockKeyRef.current++, type: 'error', content: event.message || '' },
            ]);
            break;
          case 'done':
            setStreamPhase('done');
            // Drop the conclusion from the pending think content…
            flushBufferToBlocks(event.message || '');
            // …and show it exactly once as the "analysis done" summary block
            if (event.message) {
              setStreamingBlocks((prev) => [
                ...prev,
                { key: blockKeyRef.current++, type: 'summary', content: event.message || '' },
              ]);
            }
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
        setStreamPhase('error');
      },
      () => {
        stopFlushTimer();
        stopElapsedTimer();
        setQuerying(false);
        // Refresh conversation list after query completes
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      },
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    stopFlushTimer();
    stopElapsedTimer();
    setQuerying(false);
    setStreamPhase('idle');
    // Flush think buffer + streamingThink to blocks
    const buf = thinkBufferRef.current;
    thinkBufferRef.current = '';
    setStreamingThink((prev) => {
      const combined = prev + buf;
      if (combined.trim()) {
        setStreamingBlocks((b) => [
          ...b,
          { key: blockKeyRef.current++, type: 'think', content: combined },
        ]);
      }
      return '';
    });
  };

  const handleNewChat = () => {
    // Cancel any ongoing query
    abortRef.current?.abort();
    stopFlushTimer();
    stopElapsedTimer();
    setQuerying(false);
    setActiveConvId(null);
    setActiveConvMeta(null);
    setMessages([]);
    resetStreamState();
    setQuestion('');
    setSelectedConns([]);
    setSchemaFilters({});
    setSelectedSkillIds([]);
    setShowSkillPicker(false);
    setSlashFilter('');
  };

  const handleSelectConv = (conv: Conversation) => {
    if (querying) {
      abortRef.current?.abort();
      stopFlushTimer();
      stopElapsedTimer();
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
  const conn = activeConvMeta?.connection_name || selectedConns[0];
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
  const labelOf = (name: string) => availableConns.find((c) => c.name === name)?.label || name;
  // DB scope tags: "<connection name>: <schema list>" (schema list = allSchemas when unfiltered)
  const dbScopeTags = (() => {
    const selections: ConnectionSchemaSelection[] = activeConvMeta
      ? (activeConvMeta.connection_schemas?.length
          ? activeConvMeta.connection_schemas
          : [{ connection_name: activeConvMeta.connection_name, schemas: [] }])
      : selectedConns.map((c) => ({ connection_name: c, schemas: schemaFilters[c] || [] }));
    return selections.map((s) => ({
      key: s.connection_name,
      text: `${s.connection_name}: ${s.schemas?.length ? s.schemas.join(', ') : t('chat.allSchemas')}`,
    }));
  })();
  const convDbText = (conv: Conversation) => {
    const names = conv.connection_schemas?.length
      ? conv.connection_schemas.map((s) => s.connection_name)
      : [conv.connection_name];
    const shown = names.slice(0, 2).join(', ');
    return shown + (names.length > 2 ? ` +${names.length - 2}` : '');
  };
  const llmName = (llmConfigs || []).find((c) => c.id === llmId)?.name || '';

  // ── Merge historic + streaming messages for display ──
  const displayMessages = [...messages];

  // ── Memoized streaming think node to avoid re-parsing on elapsed timer ticks ──
  const streamingThinkNode = useMemo(() => {
    if (!streamingThink) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <MarkdownRenderer text={streamingThink} />
      </div>
    );
  }, [streamingThink]);

  // ── Anchor navigation ──
  const userMessages = useMemo(
    () => displayMessages.filter((m) => m.role === 'user'),
    [displayMessages],
  );
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);

  useEffect(() => {
    if (userMessages.length < 2) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveAnchor(Number((entry.target as HTMLElement).dataset.msgId));
            break;
          }
        }
      },
      { root: container, threshold: 0.4 },
    );
    userMessages.forEach((m) => {
      const el = document.getElementById(`msg-${m.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [userMessages]);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', gap: 0 }}>
      {/* Sidebar toggle button */}
      <Button
        type="text"
        icon={sidebarVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
        onClick={() => setSidebarVisible(!sidebarVisible)}
        title={sidebarVisible ? t('common.collapse') : t('common.expand')}
        style={{ flexShrink: 0, marginTop: 4 }}
      />

      {/* ─── Left Sidebar: Conversation List ─── */}
      {sidebarVisible && (
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
                      {convDbText(conv)} · {t('chat.messages', { count: conv.message_count })} · {fmtTime(conv.updated_at)}
                    </div>
                    {conv.skill_ids && conv.skill_ids.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {conv.skill_ids.slice(0, 3).map((sid) => {
                          const skillName = (skills || []).find((s) => s.id === sid)?.name;
                          if (!skillName) return null;
                          return (
                            <Tag key={sid} color="purple" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                              {skillName}
                            </Tag>
                          );
                        })}
                        {conv.skill_ids.length > 3 && (
                          <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                            +{conv.skill_ids.length - 3}
                          </Tag>
                        )}
                      </div>
                    )}
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
      )}

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
              {dbScopeTags.slice(0, 3).map((tag) => (
                <Tag key={tag.key} color="cyan">{tag.text}</Tag>
              ))}
              {dbScopeTags.length > 3 && <Tag>+{dbScopeTags.length - 3}</Tag>}
              <Tag color="blue">{llmName}</Tag>
            </>
          ) : (
            <>
              <Text strong style={{ fontSize: 15 }}>{t('chat.newSession')}</Text>
              <Space wrap style={{ flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666' }}>{t('chat.dbLabel')}</span>
                <Select
                  mode="multiple"
                  placeholder={t('chat.selectDBs')}
                  value={selectedConns}
                  onChange={(v: string[]) => {
                    setSelectedConns(v);
                    // Drop schema filters for deselected connections
                    setSchemaFilters((prev) => {
                      const next: Record<string, string[]> = {};
                      v.forEach((c) => { if (prev[c]) next[c] = prev[c]; });
                      return next;
                    });
                  }}
                  loading={loadingConns}
                  style={{ minWidth: 240, maxWidth: 360 }}
                  maxTagCount={2}
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
                {selectedConns.length > 0 && (
                  <>
                    <span style={{ fontSize: 13, color: '#666' }}>{t('chat.schemaLabel')}</span>
                    {selectedConns.map((c) => {
                      const schemas = schemasMap[c] || [];
                      const loading = !!schemasLoading[c];
                      if (schemas.length === 0 && !loading) {
                        return (
                          <Text key={c} type="secondary" style={{ fontSize: 12 }}>
                            {t('chat.schemasLoadFailed', { db: labelOf(c) })}
                          </Text>
                        );
                      }
                      return (
                        <Select
                          key={c}
                          mode="multiple"
                          placeholder={`${labelOf(c)} · ${t('chat.allSchemas')}`}
                          value={schemaFilters[c] || []}
                          onChange={(v: string[]) => setSchemaFilters((prev) => ({ ...prev, [c]: v }))}
                          loading={loading}
                          style={{ minWidth: 180, maxWidth: 300 }}
                          maxTagCount={1}
                          options={schemas.map((s) => ({ value: s, label: s }))}
                          notFoundContent={loading ? <Spin size="small" /> : t('chat.noSchemas')}
                        />
                      );
                    })}
                  </>
                )}
              </Space>
            </>
          )}
        </div>

        {/* Messages Area */}
        <div ref={messagesContainerRef} style={{
          flex: 1, overflowY: 'auto', padding: '16px 24px',
          background: '#f5f5f5',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
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

          {/* Anchor navigation */}
          {userMessages.length >= 2 && (
            <div style={{
              position: 'sticky',
              top: 16,
              alignSelf: 'flex-end',
              marginRight: 8,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              background: 'rgba(255,255,255,0.9)',
              borderRadius: 16,
              padding: '6px 4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}>
              {userMessages.map((msg, idx) => (
                <div
                  key={msg.id}
                  onClick={() => {
                    document.getElementById(`msg-${msg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  title={msg.question.substring(0, 60)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: activeAnchor === msg.id ? '#1890ff' : '#f0f0f0',
                    color: activeAnchor === msg.id ? '#fff' : '#888',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    transition: 'all 0.2s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (activeAnchor !== msg.id) {
                      (e.currentTarget as HTMLElement).style.background = '#e6f4ff';
                      (e.currentTarget as HTMLElement).style.color = '#1890ff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeAnchor !== msg.id) {
                      (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                      (e.currentTarget as HTMLElement).style.color = '#888';
                    }
                  }}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          )}

          {/* Historic messages */}
          {displayMessages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 20 }}>
              {/* User message */}
              {msg.role === 'user' && (
              <div id={`msg-${msg.id}`} data-msg-id={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 8 }}>
                <div style={{
                  maxWidth: 'calc(100% - 40px)',
                  background: '#1890ff', color: '#fff',
                  borderRadius: '12px 12px 4px 12px',
                  padding: '10px 16px',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {msg.question}
                </div>
                {/* DB scope tags: which databases & schemas this conversation queries */}
                <div style={{ marginTop: 3, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {dbScopeTags.map((tag) => (
                    <Tag key={tag.key} color="cyan" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>{tag.text}</Tag>
                  ))}
                </div>
                {(() => {
                  try {
                    const ids: number[] = JSON.parse(msg.skill_ids || '[]');
                    if (ids.length > 0) {
                      const names = ids
                        .map((sid) => (skills || []).find((s) => s.id === sid)?.name)
                        .filter(Boolean) as string[];
                      if (names.length > 0) {
                        return (
                          <div style={{ marginTop: 3, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {names.map((name, i) => (
                              <Tag key={i} color="purple" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                                {name}
                              </Tag>
                            ))}
                          </div>
                        );
                      }
                    }
                  } catch { /* ignore parse errors */ }
                  return null;
                })()}
              </div>
              )}

              {/* Assistant message */}
              {msg.role === 'assistant' && parseAnswerBlocks(msg.answer_blocks).length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    maxWidth: 'calc(100% - 40px)',
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
                  maxWidth: 'calc(100% - 40px)',
                  background: '#1890ff', color: '#fff',
                  borderRadius: '12px 12px 4px 12px',
                  padding: '10px 16px',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {question}
                </div>
              </div>
              {/* DB scope tags for the streaming question */}
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 8 }}>
                {dbScopeTags.map((tag) => (
                  <Tag key={tag.key} color="cyan" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>{tag.text}</Tag>
                ))}
              </div>

              {/* AI streaming bubble */}
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  maxWidth: 'calc(100% - 40px)',
                  background: '#fff',
                  borderRadius: '12px 12px 12px 4px',
                  padding: '12px 16px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  overflowX: 'auto',
                  minWidth: 0,
                }}>
                  {streamingBlocks.map((block) => (
                    <MemoBlockView key={block.key} block={block} />
                  ))}

                  {streamingThinkNode}

                  {querying && streamingBlocks.length === 0 && !streamingThink && (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                      <Spin />
                      <div style={{ marginTop: 8 }}>
                        <Text type="secondary">{t('block.phaseConnecting')}</Text>
                      </div>
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

        {/* Status Bar */}
        {querying && streamPhase !== 'idle' && (() => {
          const phaseLabel =
            streamPhase === 'connecting' ? t('block.phaseConnecting') :
            streamPhase === 'thinking' ? t('block.phaseThinking') :
            streamPhase === 'executing' ? t('block.phaseExecuting') :
            streamPhase === 'error' ? t('chat.queryFailed') :
            t('block.thinking');
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 24px',
              background: '#f6ffed',
              borderTop: '1px solid #b7eb8f',
              borderBottom: '1px solid #b7eb8f',
            }}>
              <Spin size="small" />
              <Text style={{ fontSize: 13, color: '#52c41a', fontWeight: 500 }}>
                {phaseLabel}
              </Text>
              {elapsedSeconds > 0 && (
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {t('chat.elapsed', { time: elapsedSeconds.toFixed(1) })}
                </Text>
              )}
            </div>
          );
        })()}

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
