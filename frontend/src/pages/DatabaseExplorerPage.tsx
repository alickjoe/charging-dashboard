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
import { BarChartOutlined, TableOutlined, CodeOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
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
import { useTranslation } from 'react-i18next';

export default function DatabaseExplorerPage() {
  const { t } = useTranslation();
  const { connectionName } = useParams<{ connectionName: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSchema, setSelectedSchema] = useState<string>('public');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [timeFrom, setTimeFrom] = useState<string | undefined>();
  const [timeTo, setTimeTo] = useState<string | undefined>();

  // Sidebar toggle for responsive layout
  const [sidebarVisible, setSidebarVisible] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => setSidebarVisible(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const handleGoToQuery = () => {
    if (connectionName) {
      navigate(`/queries/${connectionName}`);
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
      message.success(t('msg.tableAnnotationSaved'));
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
    } catch {
      message.error(t('msg.saveFail'));
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
      message.success(t('msg.columnAnnotationSaved', { column: columnName }));
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
    } catch {
      message.error(t('msg.saveFail'));
    } finally {
      setSavingColumn(null);
    }
  };

  const handleDeleteAnnotation = async (columnName?: string) => {
    if (!connectionName || !selectedTable) return;
    try {
      await deleteAnnotation(connectionName, selectedTable, columnName);
      message.success(t('msg.annotationDeleted'));
      queryClient.invalidateQueries({ queryKey: annotationsQueryKey });
      if (columnName) {
        setEditingColumnAnnotations((prev) => ({ ...prev, [columnName]: '' }));
      } else {
        setEditingTableAnnotation('');
      }
    } catch {
      message.error(t('msg.deleteFail'));
    }
  };

  const { TextArea } = Input;

  if (!connectionName) {
    return <Alert type="error" message={t('database.missingConnection')} showIcon />;
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/connections">{t('breadcrumb.connections')}</a> },
          { title: connectionName },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <span>{t('database.schema')}</span>
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
            {t('database.generateChart')}
          </Button>
        )}
        <Button
          icon={<CodeOutlined />}
          onClick={handleGoToQuery}
        >
          {t('customQuery.title')}
        </Button>
      </Space>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Sidebar toggle button */}
        <Button
          type="text"
          icon={sidebarVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          onClick={() => setSidebarVisible(!sidebarVisible)}
          title={sidebarVisible ? t('common.collapse') : t('common.expand')}
        />

        {/* Table List */}
        {sidebarVisible && (
        <Card
          title={t('database.tables', { count: tables?.length || 0 })}
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
                    description={`${t('database.rows', { count: table.row_count_estimate })}`}
                  />
                </List.Item>
              )}
              style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}
            />
          )}
        </Card>
        )}

        {/* Data Panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedTable ? (
            <Alert
              type="info"
              message={t('database.selectTable')}
              description={t('database.selectTableDesc')}
              showIcon
            />
          ) : (
            <Tabs
              defaultActiveKey="data"
              items={[
                {
                  key: 'structure',
                  label: t('database.structure'),
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
                  label: t('database.data'),
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
                  label: t('database.annotations'),
                  children: annotationsLoading || columnsLoading ? (
                    <Spin />
                  ) : (
                    <div>
                      {/* Table-level annotation */}
                      <Card
                        size="small"
                        title={t('database.tableAnnotation')}
                        style={{ marginBottom: 16 }}
                        extra={
                          <Space>
                            {tableAnnotation && (
                              <Button
                                size="small"
                                danger
                                onClick={() => handleDeleteAnnotation()}
                              >
                                {t('common.delete')}
                              </Button>
                            )}
                            <Button
                              type="primary"
                              size="small"
                              loading={savingTable}
                              onClick={handleSaveTableAnnotation}
                            >
                              {t('common.save')}
                            </Button>
                          </Space>
                        }
                      >
                        <div>
                          <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
                            {t('database.addTableAnnotation', { table: selectedTable })}
                          </div>
                          <TextArea
                            value={editingTableAnnotation}
                            onChange={(e) => setEditingTableAnnotation(e.target.value)}
                            placeholder={t('database.tableAnnotationPlaceholder')}
                            rows={3}
                          />
                        </div>
                      </Card>

                      {/* Column-level annotations */}
                      <Card size="small" title={t('database.columnAnnotation')}>
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
                              <div style={{ width: 180, flexShrink: 0, minWidth: 120 }}>
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
                                  placeholder={t('database.columnAnnotationPlaceholder')}
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
                                    {t('common.delete')}
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
                                  {t('common.save')}
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
