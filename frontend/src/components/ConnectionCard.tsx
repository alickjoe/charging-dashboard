import { Card, Tag, Button, Space, message, Popconfirm } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { testConnection } from '../api/connections';
import { deleteConnection } from '../api/connections-admin';
import type { ConnectionInfo } from '../types';
import { useState } from 'react';

interface ConnectionCardProps {
  connection: ConnectionInfo;
  onEdit: (conn: ConnectionInfo) => void;
}

export default function ConnectionCard({ connection, onEdit }: ConnectionCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    connected: { color: 'green', icon: <CheckCircleOutlined />, text: '已连接' },
    disconnected: { color: 'orange', icon: <QuestionCircleOutlined />, text: '未连接' },
    error: { color: 'red', icon: <CloseCircleOutlined />, text: '错误' },
    unknown: { color: 'default', icon: <QuestionCircleOutlined />, text: '未检测' },
  };

  const status = statusConfig[connection.status] ?? statusConfig.unknown;

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnection(connection.name);
      if (result.status === 'connected') {
        message.success(`${result.message} (${result.latency_ms}ms)`);
      } else {
        message.error(result.message);
      }
      // Update status in cache directly so the card reflects the result
      queryClient.setQueryData<ConnectionInfo[]>(
        ['connections'],
        (old) =>
          (old || []).map((c) =>
            c.name === connection.name
              ? { ...c, status: result.status, last_checked: new Date().toISOString() }
              : c
          )
      );
    } catch {
      message.error('测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteConnection(connection.name);
      message.success('连接已删除');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const handleEdit = () => {
    onEdit(connection);
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
          <Button icon={<EditOutlined />} onClick={handleEdit}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除此连接？"
            description="连接池将被销毁，此操作不可撤销。"
            onConfirm={handleDelete}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      </Space>
    </Card>
  );
}
