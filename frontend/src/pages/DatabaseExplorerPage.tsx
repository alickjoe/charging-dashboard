import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
} from 'antd';
import { BarChartOutlined, TableOutlined } from '@ant-design/icons';
import {
  fetchSchemas,
  fetchTables,
  fetchColumns,
  fetchTableData,
} from '../api/databases';
import DataTable from '../components/DataTable';
import TimeFilter from '../components/TimeFilter';

export default function DatabaseExplorerPage() {
  const { connectionName } = useParams<{ connectionName: string }>();
  const navigate = useNavigate();
  const [selectedSchema, setSelectedSchema] = useState<string>('public');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [timeFrom, setTimeFrom] = useState<string | undefined>();
  const [timeTo, setTimeTo] = useState<string | undefined>();

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
    queryKey: ['columns', connectionName, selectedTable],
    queryFn: () => fetchColumns(connectionName!, selectedTable!),
    enabled: !!connectionName && !!selectedTable,
  });

  const { data: tableData, isLoading: dataLoading } = useQuery({
    queryKey: ['tableData', connectionName, selectedTable, page, pageSize, timeFrom, timeTo],
    queryFn: () =>
      fetchTableData(connectionName!, selectedTable!, {
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

  const handleTableClick = (tableName: string) => {
    setSelectedTable(tableName);
    setPage(1);
  };

  const handleGoToChart = () => {
    if (connectionName && selectedTable) {
      navigate(`/charts/${connectionName}/${selectedTable}`);
    }
  };

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
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
