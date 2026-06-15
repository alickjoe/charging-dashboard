import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Select,
  List,
  Card,
  Spin,
  Alert,
  Tabs,
  Space,
  Button,
  Descriptions,
  Tag,
  Breadcrumb,
  Input,
  message,
} from 'antd';
import { BarChartOutlined, TableOutlined } from '@ant-design/icons';
import {
  fetchSchemas,
  fetchTables,
  fetchColumns,
  fetchTableData,
  fetchAnnotations,
  upsertAnnotation,
  deleteAnnotation,
} from '../api/databases';
import type { Annotation } from '../types';
import DataTable from '../components/DataTable';
import TimeFilter from '../components/TimeFilter';

export default function DatabaseExplorerPage() {
  const { connectionName } = useParams<{ connectionName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSchema, setSelectedSchema] = useState<string>('public');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [timeFrom, setTimeFrom] = useState<string | undefined>();
  const [timeTo, setTimeTo] = useState<string | undefined>();

  // Annotation editing state
  const [editingTableAnnotation, setEditingTableAnnotation] = useState('');
  const [editingColumnAnnotations, setEditingColumnAnnotations] = useState<Record<string, string>>({});
  const [savingTable, setSavingTable] = useState(false);
  const [savingColumn, setSavingColumn] = useState<string | null>(null);

  const { data: schemas, isLoading: schemasLoading } = useQuery({
    queryKey: ['schemas', connectionName],
    queryFn: () => fetchSchemas(connectionName!),
    enabled: !!connectionName,
  });

  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ['tables', connectionName, selectedSchema],
    queryFn: () => fetchTables(connectionName!, selectedSchema),
    enabled: !!connectionName,
  });

  const { data: columns, isLoading: columnsLoading } = useQuery({
    queryKey: ['columns', connectionName, selectedSchema, selectedTable],
    queryFn: () => fetchColumns(connectionName!, selectedTable!, selectedSchema),
    enabled: !!connectionName && !!selectedTable,
  });

  const { data: tableData, isLoading: dataLoading } = useQuery({
    queryKey: ['tableData', connectionName, selectedSchema, selectedTable, page, pageSize, timeFrom, timeTo],
    queryFn: () =>
      fetchTableData(connectionName!, selectedTable!, {
        schema: selectedSchema,
        page,
        page_size: pageSize,
        time_from: timeFrom,
        time_to: timeTo,
      }),
    enabled: !!connectionName && !!selectedTable,
  });

  const handlePageChange = useCallback((p: number, ps: number) => {
    setPage(p);
    setPageSize(ps);
  }, []);

  const handleTimeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      setTimeFrom(from);
      setTimeTo(to);
      setPage(1);
    },
    []
  );

  const handleGoToChart = () => {
    if (connectionName && selectedTable) {
      navigate(`/charts/${connectionName}/${selectedSchema}/${selectedTable}`);
    }
  };

  // ─── Annotations ──────────────────────────────────────────────────

  const annotationsQueryKey = ['annotations', connectionName];

  const { data: annotations, isLoading: annotationsLoading } = useQuery({
    queryKey: annotationsQueryKey,
    queryFn: () => fetchAnnotations(connectionName!),
    enabled: !!connectionName,
  });

  // Build lookup from annotations when data arrives
  const tableAnnotation = (annotations || []).find(
    (a: Annotation) => a.table_name === selectedTable && a.column_name === null
  );
  const columnAnnotationsMap: Record<string, Annotation> = {};
  (annotations || []).forEach((a: Annotation) => {
    if (a.table_name === selectedTable && a.column_name !== null) {
      columnAnnotationsMap[a.column_name] = a;
    }
  });

  // Sync editing state only when selected table changes
  const syncedTable = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTable || !columns || annotationsLoading || columnsLoading) return;
    if (syncedTable.current === selectedTable) return;
    syncedTable.current = selectedTable;

    const ta = (annotations || []).find(
      (a: Annotation) => a.table_name === selectedTable && a.column_name === null
    );
    setEditingTableAnnotation(ta?.annotation || '');

    const colDefaults: Record<string, string> = {};
    columns.forEach((col) => {
      const ca = (annotations || []).find(
        (a: Annotation) => a.table_name === selectedTable && a.column_name === col.column_name
      );
      colDefaults[col.column_name] = ca?.annotation || '';
    });
    setEditingColumnAnnotations(colDefaults);
  }, [selectedTable, columns, annotations, annotationsLoading, columnsLoading]);

  const handleTableClick = (tableName: string) => {
    setSelectedTable(tableName);
    setPage(1);
  };

  const handleSaveTableAnnotation = async () => {
    if (!connectionName || !selectedTable) return;
    setSavingTable(true);
    try {
      await upsertAnnotation(connectionName, {
        table_name: selectedTable,
        column_name: undefined,
        annotation: editingTableAnnotation,
      });
      message.success('表注解已保存');
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
    } catch {
      message.error('保存失败');
    } finally {
      setSavingTable(false);
    }
  };

  const handleSaveColumnAnnotation = async (columnName: string) => {
    if (!connectionName || !selectedTable) return;
    setSavingColumn(columnName);
    try {
      await upsertAnnotation(connectionName, {
        table_name: selectedTable,
        column_name: columnName,
        annotation: editingColumnAnnotations[columnName] || '',
      });
      message.success(`字段 "${columnName}" 注解已保存`);
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
    } catch {
      message.error('保存失败');
    } finally {
      setSavingColumn(null);
    }
  };

  const handleDeleteAnnotation = async (columnName?: string) => {
    if (!connectionName || !selectedTable) return;
    try {
      await deleteAnnotation(connectionName, selectedTable, columnName);
      message.success('注解已删除');
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
      if (columnName) {
        setEditingColumnAnnotations((prev) => ({ ...prev, [columnName]: '' }));
      } else {
        setEditingTableAnnotation('');
      }
    } catch {
      message.error('删除失败');
    }
  };

  const { TextArea } = Input;

  if (!connectionName) {
    return <Alert type="error" message="缺少连接名称参数" showIcon />;
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/connections">连接管理</a> },
          { title: connectionName },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <span>Schema：</span>
          {schemasLoading ? (
            <Spin size="small" />
          ) : (
            <Select
              value={selectedSchema}
              onChange={(v) => {
                setSelectedSchema(v);
                setSelectedTable(null);
              }}
              style={{ width: 200 }}
              options={(schemas || ['public']).map((s) => ({
                value: s,
                label: s,
              }))}
            />
          )}
        </Space>
        {selectedTable && (
          <Button
            type="primary"
            icon={<BarChartOutlined />}
            onClick={handleGoToChart}
          >
            生成图表
          </Button>
        )}
      </Space>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Table List */}
        <Card
          title={`表列表 (${tables?.length || 0})`}
          style={{ width: 280, flexShrink: 0 }}
          bodyStyle={{ padding: 0 }}
        >
          {tablesLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : (
            <List
              dataSource={tables || []}
              renderItem={(table) => (
                <List.Item
                  onClick={() => handleTableClick(table.table_name)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    background:
                      selectedTable === table.table_name ? '#e6f4ff' : undefined,
                  }}
                >
                  <List.Item.Meta
                    avatar={<TableOutlined />}
                    title={table.table_name}
                    description={`~${table.row_count_estimate.toLocaleString()} 行`}
                  />
                </List.Item>
              )}
              style={{ maxHeight: 500, overflow: 'auto' }}
            />
          )}
        </Card>

        {/* Data Panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedTable ? (
            <Alert
              type="info"
              message="请选择一个数据表"
              description="从左侧列表中选择一张表来查看其结构和数据。"
              showIcon
            />
          ) : (
            <Tabs
              defaultActiveKey="data"
              items={[
                {
                  key: 'structure',
                  label: '表结构',
                  children: columnsLoading ? (
                    <Spin />
                  ) : (
                    <Descriptions bordered size="small" column={1}>
                      {(columns || []).map((col) => (
                        <Descriptions.Item
                          key={col.column_name}
                          label={col.column_name}
                        >
                          <Space>
                            <Tag color="blue">{col.data_type}</Tag>
                            {col.is_primary_key && <Tag color="gold">PK</Tag>}
                            {col.is_nullable === 'NO' && (
                              <Tag color="red">NOT NULL</Tag>
                            )}
                          </Space>
                        </Descriptions.Item>
                      ))}
                    </Descriptions>
                  ),
                },
                {
                  key: 'data',
                  label: '数据浏览',
                  children: (
                    <div>
                      <div style={{ marginBottom: 16 }}>
                        <TimeFilter
                          onChange={handleTimeChange}
                          disabled={!selectedTable}
                        />
                      </div>
                      {tableData ? (
                        <DataTable
                          data={tableData}
                          loading={dataLoading}
                          onPageChange={handlePageChange}
                        />
                      ) : (
                        <Spin />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'annotations',
                  label: '业务注解',
                  children: annotationsLoading || columnsLoading ? (
                    <Spin />
                  ) : (
                    <div>
                      {/* Table-level annotation */}
                      <Card
                        size="small"
                        title="表级注解"
                        style={{ marginBottom: 16 }}
                        extra={
                          <Space>
                            {tableAnnotation && (
                              <Button
                                size="small"
                                danger
                                onClick={() => handleDeleteAnnotation()}
                              >
                                删除
                              </Button>
                            )}
                            <Button
                              type="primary"
                              size="small"
                              loading={savingTable}
                              onClick={handleSaveTableAnnotation}
                            >
                              保存
                            </Button>
                          </Space>
                        }
                      >
                        <div>
                          <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
                            为表 <Tag>{selectedTable}</Tag> 添加业务说明
                          </div>
                          <TextArea
                            value={editingTableAnnotation}
                            onChange={(e) => setEditingTableAnnotation(e.target.value)}
                            placeholder="例如：充电站基础信息表，记录每个充电站的地理位置和额定功率"
                            rows={3}
                          />
                        </div>
                      </Card>

                      {/* Column-level annotations */}
                      <Card size="small" title="字段注解">
                        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                          {(columns || []).map((col) => (
                            <div
                              key={col.column_name}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 12,
                                padding: '12px 0',
                                borderBottom: '1px solid #f0f0f0',
                              }}
                            >
                              <div style={{ width: 180, flexShrink: 0 }}>
                                <Space size={4}>
                                  <strong>{col.column_name}</strong>
                                  <Tag color="blue" style={{ margin: 0 }}>
                                    {col.data_type}
                                  </Tag>
                                </Space>
                              </div>
                              <div style={{ flex: 1 }}>
                                <Input
                                  value={editingColumnAnnotations[col.column_name] || ''}
                                  onChange={(e) =>
                                    setEditingColumnAnnotations((prev) => ({
                                      ...prev,
                                      [col.column_name]: e.target.value,
                                    }))
                                  }
                                  placeholder="输入字段的业务含义…"
                                  size="small"
                                />
                              </div>
                              <Space size={4} style={{ flexShrink: 0 }}>
                                {columnAnnotationsMap[col.column_name] && (
                                  <Button
                                    size="small"
                                    danger
                                    onClick={() =>
                                      handleDeleteAnnotation(col.column_name)
                                    }
                                  >
                                    删除
                                  </Button>
                                )}
                                <Button
                                  type="primary"
                                  size="small"
                                  loading={savingColumn === col.column_name}
                                  onClick={() =>
                                    handleSaveColumnAnnotation(col.column_name)
                                  }
                                >
                                  保存
                                </Button>
                              </Space>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
