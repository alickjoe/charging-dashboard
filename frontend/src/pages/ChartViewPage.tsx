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
import { useTranslation } from 'react-i18next';

export default function ChartViewPage() {
  const { t } = useTranslation();
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
    return <Alert type="error" message={t('chart.missingParams')} showIcon />;
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
          { title: <a href="/connections">{t('breadcrumb.connections')}</a> },
          {
            title: (
              <a href={`/databases/${connectionName}`}>{connectionName}</a>
            ),
          },
          { title: t('chart.breadcrumbChart', { table: tableName }) },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Card title={t('chart.title')} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <span>{t('chart.xAxis')}</span>
            <Select
              value={xColumn}
              onChange={setXColumn}
              placeholder={t('chart.selectX')}
              style={{ width: 250 }}
              options={columnOptions}
              loading={columnsLoading}
              showSearch
            />
            <span>{t('chart.yAxis')}</span>
            <Select
              value={yColumn}
              onChange={setYColumn}
              placeholder={t('chart.selectY')}
              style={{ width: 250 }}
              options={columnOptions}
              loading={columnsLoading}
              showSearch
            />
          </Space>

          <Space wrap>
            <span>{t('chart.chartType')}</span>
            <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value)}>
              <Radio.Button value="bar">{t('chart.bar')}</Radio.Button>
              <Radio.Button value="line">{t('chart.line')}</Radio.Button>
            </Radio.Group>

            <span>{t('chart.aggregation')}</span>
            <Select
              value={aggregation}
              onChange={setAggregation}
              style={{ width: 120 }}
              options={[
                { value: 'sum', label: t('chart.sum') },
                { value: 'avg', label: t('chart.avg') },
                { value: 'count', label: t('chart.count') },
                { value: 'none', label: t('chart.none') },
              ]}
            />

            <span>{t('chart.groupBy')}</span>
            <Select
              value={groupBy}
              onChange={setGroupBy}
              style={{ width: 180 }}
              options={[
                { value: 'date_trunc_day', label: t('chart.byDay') },
                { value: 'date_trunc_hour', label: t('chart.byHour') },
                { value: 'date_trunc_month', label: t('chart.byMonth') },
                { value: 'none', label: t('chart.noGrouping') },
              ]}
            />

            <span>{t('chart.dataCount')}</span>
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
            {t('chart.generate')}
          </Button>
        </Space>
      </Card>

      <Card title={t('chart.result')}>
        <ChartRenderer
          data={chartData}
          chartType={chartType}
          loading={chartLoading}
        />
      </Card>
    </div>
  );
}
