import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ChartDataResponse } from '../types';

interface ChartRendererProps {
  data: ChartDataResponse | null;
  chartType: 'bar' | 'line';
  loading: boolean;
}

export default function ChartRenderer({ data, chartType, loading }: ChartRendererProps) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
        加载中...
      </div>
    );
  }

  if (!data || data.labels.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
        暂无图表数据，请选择列并生成图表
      </div>
    );
  }

  const chartData = data.labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    data.datasets.forEach((ds) => {
      row[ds.label] = ds.data[i] ?? 0;
    });
    return row;
  });

  const ChartComponent = chartType === 'bar' ? BarChart : LineChart;
  const DataComponent = chartType === 'bar' ? Bar : Line;

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ChartComponent data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Legend />
        {data.datasets.map((ds) => (
          <DataComponent
            key={ds.label}
            type="monotone"
            dataKey={ds.label}
            fill={chartType === 'bar' ? '#1677ff' : undefined}
            stroke="#1677ff"
          />
        ))}
      </ChartComponent>
    </ResponsiveContainer>
  );
}
