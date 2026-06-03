import { Card, Tag, Button, Space, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { testConnection } from '../api/connections';
import type { ConnectionInfo } from '../types';
import { useState } from 'react';

interface ConnectionCardProps {
  connection: ConnectionInfo;
}

export default function ConnectionCard({ connection }: ConnectionCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);

  const statusConfig = {
    connected: { color: 'green', icon: <CheckCircleOutlined />, text: '已连接' },
    disconnected: { color: 'orange', icon: <QuestionCircleOutlined />, text: '未连接' },
    error: { color: 'red', icon: <CloseCircleOutlined />, text: '错误' },
  };

  const status = statusConfig[connection.status];

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnection(connection.name);
      if (result.status === 'connected') {
        message.success(`${result.message} (${result.latency_ms}ms)`);
      } else {
        message.error(result.message);
      }
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch {
      message.error('测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleBrowse = () => {
    navigate(`/databases/${connection.name}`);
  };

  return (
    <Card
      title={connection.label}
      extra={
        <Tag icon={status.icon} color={status.color}>
          {status.text}
        </Tag>
      }
      style={{ width: '100%' }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <strong>主机：</strong>{connection.host}:{connection.port}
        </div>
        <div>
          <strong>数据库：</strong>{connection.database}
        </div>
        {connection.last_checked && (
          <div>
            <strong>上次检测：</strong>
            {new Date(connection.last_checked).toLocaleString('zh-CN')}
          </div>
        )}
        <Space style={{ marginTop: 8 }}>
          <Button
            type="primary"
            icon={<EyeOutlined />}
            onClick={handleBrowse}
          >
            浏览数据
          </Button>
          <Button
            icon={testing ? undefined : <ReloadOutlined />}
            onClick={handleTest}
            loading={testing}
          >
            测试连接
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
