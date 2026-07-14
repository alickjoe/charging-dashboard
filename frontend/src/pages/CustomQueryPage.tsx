import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  List,
  Spin,
  Alert,
  Space,
  Button,
  Breadcrumb,
  Input,
  Table,
  message,
  Popconfirm,
  Typography,
  Tag,
} from 'antd';
import {
  PlayCircleOutlined,
  SaveOutlined,
  DeleteOutlined,
  ClearOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  executeCustomQuery,
  fetchSavedQueries,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
  fetchAutocomplete,
} from '../api/customQuery';
import type { CustomQueryResponse, SavedQuery, AutocompleteSuggestion } from '../types';
import { useTranslation } from 'react-i18next';

const { TextArea } = Input;
const { Text } = Typography;

export default function CustomQueryPage() {
  const { t } = useTranslation();
  const { connectionName } = useParams<{ connectionName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sql, setSql] = useState('');
  const [queryName, setQueryName] = useState('');
  const [currentQueryId, setCurrentQueryId] = useState<number | null>(null);
  const [executing, setExecuting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CustomQueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Autocomplete state
  const [autocompleteVisible, setAutocompleteVisible] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const textareaRef = useRef<any>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorRef = useRef(0);

  // Sidebar toggle for responsive layout
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => setSidebarVisible(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const savedQueriesKey = ['savedQueries', connectionName];

  const { data: savedQueries, isLoading: queriesLoading } = useQuery({
    queryKey: savedQueriesKey,
    queryFn: () => fetchSavedQueries(connectionName!),
    enabled: !!connectionName,
  });

  const handleExecute = useCallback(async () => {
    setAutocompleteVisible(false);
    if (!sql.trim()) return;
    setExecuting(true);
    setQueryError(null);
    setResult(null);
    try {
      const res = await executeCustomQuery(connectionName!, { sql: sql.trim() });
      setResult(res);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || t('customQuery.queryError');
      setQueryError(detail);
    } finally {
      setExecuting(false);
    }
  }, [sql, connectionName, t]);

  const handleSave = useCallback(async () => {
    if (!queryName.trim()) {
      message.warning(t('customQuery.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      if (currentQueryId) {
        await updateSavedQuery(connectionName!, currentQueryId, {
          name: queryName.trim(),
          sql_text: sql,
        });
        message.success(t('msg.saved'));
      } else {
        await createSavedQuery(connectionName!, {
          name: queryName.trim(),
          sql_text: sql,
        });
        message.success(t('msg.saved'));
      }
      queryClient.invalidateQueries({ queryKey: savedQueriesKey });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('msg.saveFail'));
    } finally {
      setSaving(false);
    }
  }, [queryName, sql, currentQueryId, connectionName, queryClient, savedQueriesKey, t]);

  const handleSaveAs = useCallback(async () => {
    if (!queryName.trim()) {
      message.warning(t('customQuery.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const created = await createSavedQuery(connectionName!, {
        name: queryName.trim(),
        sql_text: sql,
      });
      setCurrentQueryId(created.id);
      message.success(t('msg.saved'));
      queryClient.invalidateQueries({ queryKey: savedQueriesKey });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('msg.saveFail'));
    } finally {
      setSaving(false);
    }
  }, [queryName, sql, connectionName, queryClient, savedQueriesKey, t]);

  const handleNewQuery = useCallback(() => {
    setSql('');
    setQueryName('');
    setCurrentQueryId(null);
    setResult(null);
    setQueryError(null);
    setAutocompleteVisible(false);
  }, []);

  const handleLoadQuery = useCallback((query: SavedQuery) => {
    setSql(query.sql_text);
    setQueryName(query.name);
    setCurrentQueryId(query.id);
    setResult(null);
    setQueryError(null);
  }, []);

  const handleDeleteQuery = useCallback(
    async (id: number) => {
      try {
        await deleteSavedQuery(connectionName!, id);
        message.success(t('msg.deleted'));
        queryClient.invalidateQueries({ queryKey: savedQueriesKey });
        if (currentQueryId === id) {
          setCurrentQueryId(null);
        }
      } catch {
        message.error(t('msg.deleteFail'));
      }
    },
    [connectionName, currentQueryId, queryClient, savedQueriesKey, t]
  );

  // ─── Autocomplete helpers ───────────────────────────────────────

  const extractWordBeforeCursor = useCallback(
    (text: string, cursorPos: number): string => {
      let start = cursorPos - 1;
      while (start >= 0) {
        const ch = text[start];
        if (/[\s\(\),;\[\]'"`]/.test(ch)) break;
        start--;
      }
      return text.slice(start + 1, cursorPos);
    },
    []
  );

  const triggerAutocomplete = useCallback(() => {
    if (!connectionName) return;
    const el = textareaRef.current?.resizableTextArea?.textArea;
    if (!el) return;
    const text = el.value;
    const cursorPos = el.selectionStart;
    cursorRef.current = cursorPos;
    const word = extractWordBeforeCursor(text, cursorPos);
    if (!word) {
      setAutocompleteVisible(false);
      return;
    }
    fetchAutocomplete(connectionName, word, text).then((res) => {
      if (res.suggestions.length > 0) {
        setSuggestions(res.suggestions);
        setActiveSuggestionIdx(0);
        setAutocompleteVisible(true);
      } else {
        setAutocompleteVisible(false);
      }
    }).catch(() => {
      setAutocompleteVisible(false);
    });
  }, [connectionName, extractWordBeforeCursor]);

  const applySuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      const el = textareaRef.current?.resizableTextArea?.textArea;
      if (!el) return;
      const text = el.value;
      const cursorPos = cursorRef.current;
      const word = extractWordBeforeCursor(text, cursorPos);
      const before = text.slice(0, cursorPos - word.length);
      const after = text.slice(cursorPos);
      const newText = before + suggestion.text + after;
      setSql(newText);
      setAutocompleteVisible(false);
      // Restore cursor position after React re-render
      setTimeout(() => {
        const el2 = textareaRef.current?.resizableTextArea?.textArea;
        if (el2) {
          const newPos = before.length + suggestion.text.length;
          el2.setSelectionRange(newPos, newPos);
          el2.focus();
        }
      }, 0);
    },
    [extractWordBeforeCursor]
  );

  // ─── Keyboard shortcut: Ctrl+Enter to execute ───────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleExecute]);

  if (!connectionName) {
    return <Alert type="error" message={t('database.missingConnection')} showIcon />;
  }

  // Build result table
  const resultColumns: ColumnsType<Record<string, unknown>> =
    result?.columns.map((col) => ({
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
      render: (val: unknown) => {
        if (val === null) return <span style={{ color: '#999' }}>{t('table.null')}</span>;
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        return String(val);
      },
    })) || [];

  const resultDataSource =
    result?.rows.map((row, idx) => {
      const record: Record<string, unknown> = { _key: idx };
      result.columns.forEach((col, ci) => {
        record[col] = row[ci];
      });
      return record;
    }) || [];

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/connections">{t('breadcrumb.connections')}</a> },
          {
            title: (
              <a href={`/databases/${connectionName}`}>{connectionName}</a>
            ),
          },
          { title: t('customQuery.title') },
        ]}
        style={{ marginBottom: 16 }}
      />

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Sidebar toggle button */}
        <Button
          type="text"
          icon={sidebarVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          onClick={() => setSidebarVisible(!sidebarVisible)}
          title={sidebarVisible ? t('common.collapse') : t('common.expand')}
        />

        {/* Saved Queries Panel */}
        {sidebarVisible && (
        <Card
          title={t('customQuery.savedQueries')}
          style={{ width: 280, flexShrink: 0 }}
          bodyStyle={{ padding: 0 }}
          extra={
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={handleNewQuery}
            >
              {t('customQuery.newQuery')}
            </Button>
          }
        >
          {queriesLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : (
            <List
              dataSource={savedQueries || []}
              locale={{ emptyText: t('customQuery.noQueries') }}
              renderItem={(q) => (
                <List.Item
                  onClick={() => handleLoadQuery(q)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    background:
                      currentQueryId === q.id ? '#e6f4ff' : undefined,
                  }}
                  actions={[
                    <Popconfirm
                      key="del"
                      title={t('customQuery.deleteConfirm')}
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDeleteQuery(q.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                      okText={t('common.delete')}
                      cancelText={t('common.cancel')}
                      okButtonProps={{ danger: true, size: 'small' }}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Text
                        ellipsis={{ tooltip: q.name }}
                        style={{ fontSize: 13 }}
                      >
                        {q.name}
                      </Text>
                    }
                    description={
                      <Text
                        type="secondary"
                        ellipsis={{ tooltip: q.sql_text }}
                        style={{ fontSize: 11 }}
                      >
                        {q.sql_text}
                      </Text>
                    }
                  />
                </List.Item>
              )}
              style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}
            />
          )}
        </Card>
        )}

        {/* Main Editor Area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* Query Name */}
            <Input
              value={queryName}
              onChange={(e) => setQueryName(e.target.value)}
              placeholder={t('customQuery.queryNamePlaceholder')}
              style={{ fontWeight: 500 }}
            />

            {/* SQL Editor */}
            <div style={{ position: 'relative' }}>
              <TextArea
                ref={textareaRef}
                value={sql}
                onChange={(e) => {
                  setSql(e.target.value);
                  cursorRef.current = e.target.selectionStart;
                  // Debounce autocomplete
                  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                  debounceTimerRef.current = setTimeout(triggerAutocomplete, 300);
                }}
                onKeyDown={(e) => {
                  if (!autocompleteVisible) return;
                  const key = (e as any).nativeEvent?.key || e.key;
                  if (key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSuggestionIdx((prev) =>
                      prev < suggestions.length - 1 ? prev + 1 : 0
                    );
                  } else if (key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSuggestionIdx((prev) =>
                      prev > 0 ? prev - 1 : suggestions.length - 1
                    );
                  } else if (key === 'Enter' || key === 'Tab') {
                    e.preventDefault();
                    if (suggestions[activeSuggestionIdx]) {
                      applySuggestion(suggestions[activeSuggestionIdx]);
                    }
                  } else if (key === 'Escape') {
                    e.preventDefault();
                    setAutocompleteVisible(false);
                  }
                }}
                placeholder={t('customQuery.sqlPlaceholder')}
                rows={10}
                style={{
                  fontFamily:
                    'Consolas, "Courier New", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              />
              {/* Autocomplete dropdown */}
              {autocompleteVisible && suggestions.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    right: 4,
                    maxHeight: 180,
                    overflow: 'auto',
                    background: '#fff',
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                    zIndex: 1050,
                  }}
                >
                  {suggestions.map((s, idx) => (
                    <div
                      key={`${s.type}-${s.text}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(s);
                      }}
                      style={{
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontFamily: 'Consolas, "Courier New", monospace',
                        background: idx === activeSuggestionIdx ? '#e6f4ff' : undefined,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{s.text}</span>
                      <Tag
                        color={
                          s.type === 'schema'
                            ? 'blue'
                            : s.type === 'table'
                            ? 'green'
                            : s.type === 'column'
                            ? 'orange'
                            : 'default'
                        }
                        style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}
                      >
                        {s.type === 'schema'
                          ? t('customQuery.autocompleteSchema')
                          : s.type === 'table'
                          ? t('customQuery.autocompleteTable')
                          : s.type === 'column'
                          ? t('customQuery.autocompleteColumn')
                          : t('customQuery.autocompleteKeyword')}
                      </Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecute}
                loading={executing}
              >
                {t('customQuery.execute')}
              </Button>
              <Button
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                {currentQueryId
                  ? t('customQuery.save')
                  : t('customQuery.saveAs')}
              </Button>
              {currentQueryId && (
                <Button onClick={handleSaveAs} loading={saving}>
                  {t('customQuery.saveAs')}
                </Button>
              )}
              <Button icon={<ClearOutlined />} onClick={handleNewQuery}>
                {t('customQuery.newQuery')}
              </Button>
            </Space>

            {/* Error */}
            {queryError && (
              <Alert
                type="error"
                message={t('customQuery.queryError')}
                description={queryError}
                showIcon
                closable
                onClose={() => setQueryError(null)}
              />
            )}

            {/* Results */}
            {result && (
              <Card
                size="small"
                title={`${t('block.queryResult')} (${t('block.rows', { count: result.rows.length })})`}
                extra={
                  <Text type="secondary">
                    {t('customQuery.execTime', {
                      time: result.execution_time_ms,
                    })}
                  </Text>
                }
              >
                <Table
                  columns={resultColumns}
                  dataSource={resultDataSource}
                  rowKey="_key"
                  scroll={{ x: 'max-content' }}
                  size="small"
                  pagination={
                    result.rows.length > 50
                      ? {
                          defaultPageSize: 50,
                          showSizeChanger: true,
                          pageSizeOptions: ['20', '50', '100', '200'],
                          showTotal: (total, range) =>
                            `${range[0]}-${range[1]} / ${total}`,
                        }
                      : false
                  }
                />
              </Card>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
}
