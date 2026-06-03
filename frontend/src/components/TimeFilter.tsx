import { DatePicker, Space } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface TimeFilterProps {
  onChange: (timeFrom: string | undefined, timeTo: string | undefined) => void;
  disabled?: boolean;
}

export default function TimeFilter({ onChange, disabled }: TimeFilterProps) {
  const handleChange = (
    dates: [Dayjs | null, Dayjs | null] | null
  ) => {
    if (dates && dates[0] && dates[1]) {
      onChange(
        dates[0].toISOString(),
        dates[1].toISOString()
      );
    } else {
      onChange(undefined, undefined);
    }
  };

  return (
    <Space>
      <span>时间筛选：</span>
      <RangePicker
        showTime
        disabled={disabled}
        onChange={handleChange}
        allowClear
        placeholder={['开始时间', '结束时间']}
      />
    </Space>
  );
}
