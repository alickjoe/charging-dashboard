import { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Select,
  Button,
  Card,
  Space,
  Spin,
  Breadcrumb,
  Radio,
  InputNumber,
  Alert,
} from 'antd';
import { fetchColumns } from '../api/databases';
import { fetchChartData } from '../api/charts';
import ChartRenderer from '../components/ChartRenderer';
import TimeFilter from '../components/TimeFilter';
import type { ChartDataResponse } from '../types';

export default function ChartViewPage() {
  const { connectionName, schema, tableName } = useParams<{
    connectionName: string;
    schema: string;
    tableName: string;
  }>();
  const selectedSchema = schema || 'public';

  const [xColumn, setXColumn] = useState<string | undefined>();
  const [yColumn, setYColumn] = useState<string | undefined>();
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [aggregation, setAggregation] = useState<'sum' | 'avg' | 'count' | 'none'>('sum');
  const [groupBy, setGroupBy] = useState<string>('date_trunc_day');
  const [limit, setLimit] = useState(100);
  const [timeFrom, setTimeFrom] = useState<string | undefined>();
  const [timeTo, setTimeTo] = useState<string | undefined>();
  const [chartData, setChartData] = useState<ChartDataResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const { data: columns, isLoading: columnsLoading } = useQuery({
    queryKey: ['columns', connectionName, selectedSchema, tableName],
    queryFn: () => fetchColumns(connectionName!, tableName!, selectedSchema),
    enabled: !!connectionName && !!tableName,
  });

  const handleTimeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      setTimeFrom(from);
      setTimeTo(to);
    },
    []
  );

  const handleGenerate = async () => {
    if (!xColumn || !yColumn || !connectionName || !tableName) return;

    setChartLoading(true);
    try {
      const data = await fetchChartData(connectionName, tableName, {
        x_column: xColumn,
        y_column: yColumn,
        chart_type: chartType,
        aggregation,
        group_by: groupBy,
        time_from: timeFrom,
        time_to: timeTo,
        limit,
      }, selectedSchema);
      setChartData(data);
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    } finally {
      setChartLoading(false);
    }
  };

  if (!connectionName || !tableName) {
    return <Alert type="error" message="缺少连接名称或表名参数" showIcon />;
  }

  const columnOptions =
    columns?.map((c) => ({
      value: c.column_name,
      label: `${c.column_name} (${c.data_type})`,
    })) || [];

  const isReady = xColumn && yColumn;

  return (
    <div>
      <Breadcrumb
        items={[
          { title: <a href="/connections">连接管理</a> },
          {
            title: (
              <a href={`/databases/${connectionName}`}>{connectionName}</a>
            ),
          },
          { title: `${tableName} - 图表` },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Card title="图表配置" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <span>X 轴列：</span>
            <Select
              value={xColumn}
              onChange={setXColumn}
              placeholder="选择 X 轴列"
              style={{ width: 250 }}
              options={columnOptions}
              loading={columnsLoading}
              showSearch
            />
            <span>Y 轴列：</span>
            <Select
              value={yColumn}
              onChange={setYColumn}
              placeholder="选择 Y 轴列 (数值)"
              style={{ width: 250 }}
              options={columnOptions}
              loading={columnsLoading}
              showSearch
            />
          </Space>

          <Space wrap>
            <span>图表类型：</span>
            <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value)}>
              <Radio.Button value="bar">柱状图</Radio.Button>
              <Radio.Button value="line">折线图</Radio.Button>
            </Radio.Group>

            <span>聚合方式：</span>
            <Select
              value={aggregation}
              onChange={setAggregation}
              style={{ width: 120 }}
              options={[
                { value: 'sum', label: '求和 SUM' },
                { value: 'avg', label: '平均 AVG' },
                { value: 'count', label: '计数 COUNT' },
                { value: 'none', label: '无聚合' },
              ]}
            />

            <span>分组方式：</span>
            <Select
              value={groupBy}
              onChange={setGroupBy}
              style={{ width: 180 }}
              options={[
                { value: 'date_trunc_day', label: '按天' },
                { value: 'date_trunc_hour', label: '按小时' },
                { value: 'date_trunc_month', label: '按月' },
                { value: 'none', label: '无分组' },
              ]}
            />

            <span>数据条数：</span>
            <InputNumber
              value={limit}
              onChange={(v) => setLimit(v || 100)}
              min={1}
              max={500}
            />
          </Space>

          <Space wrap>
            <TimeFilter onChange={handleTimeChange} />
          </Space>

          <Button
            type="primary"
            onClick={handleGenerate}
            loading={chartLoading}
            disabled={!isReady}
          >
            生成图表
          </Button>
        </Space>
      </Card>

      <Card title="图表结果">
        <ChartRenderer
          data={chartData}
          chartType={chartType}
          loading={chartLoading}
        />
      </Card>
    </div>
  );
}
