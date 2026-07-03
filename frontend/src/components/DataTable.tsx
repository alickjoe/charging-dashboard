import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableDataResponse } from '../types';
import { useTranslation } from 'react-i18next';

interface DataTableProps {
  data: TableDataResponse;
  loading: boolean;
  onPageChange: (page: number, pageSize: number) => void;
}

export default function DataTable({ data, loading, onPageChange }: DataTableProps) {
  const { t, i18n } = useTranslation();

  const columns: ColumnsType<Record<string, unknown>> = data.columns.map((col) => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    render: (val: unknown) => {
      if (val === null) return <span style={{ color: '#999' }}>{t('table.null')}</span>;
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val))) {
        return new Date(val as string).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US');
      }
      return String(val);
    },
  }));

  const dataSource = data.rows.map((row, index) => {
    const record: Record<string, unknown> = { _key: index };
    data.columns.forEach((col, colIndex) => {
      record[col] = row[colIndex];
    });
    return record;
  });

  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      rowKey="_key"
      loading={loading}
      scroll={{ x: 'max-content' }}
      size="small"
      pagination={{
        current: data.page,
        pageSize: data.page_size,
        total: data.total_rows,
        showSizeChanger: true,
        showQuickJumper: true,
        pageSizeOptions: ['20', '50', '100', '200'],
        showTotal: (total, range) =>
          t('table.total', { range: `${range[0]}-${range[1]}`, total }),
        onChange: onPageChange,
      }}
    />
  );
}
