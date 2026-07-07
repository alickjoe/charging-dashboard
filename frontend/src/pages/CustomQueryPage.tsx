import { useState, useCallback, useEffect } from 'react';
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
} from 'antd';
import {
  PlayCircleOutlined,
  SaveOutlined,
  DeleteOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  executeCustomQuery,
  fetchSavedQueries,
  createSavedQuery,
  updateSavedQuery,
  deleteSavedQuery,
} from '../api/customQuery';
import type { CustomQueryResponse, SavedQuery } from '../types';
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

  const savedQueriesKey = ['savedQueries', connectionName];

  const { data: savedQueries, isLoading: queriesLoading } = useQuery({
    queryKey: savedQueriesKey,
    queryFn: () => fetchSavedQueries(connectionName!),
    enabled: !!connectionName,
  });

  const handleExecute = useCallback(async () => {
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

  // Keyboard shortcut: Ctrl+Enter to execute
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

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Saved Queries Panel */}
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
              style={{ maxHeight: 500, overflow: 'auto' }}
            />
          )}
        </Card>

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
            <TextArea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={t('customQuery.sqlPlaceholder')}
              rows={10}
              style={{
                fontFamily:
                  'Consolas, "Courier New", monospace',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            />

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
                title={`${t('block.queryResult')} (${result.rows.length} ${t('block.rows')})`}
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
