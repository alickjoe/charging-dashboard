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
import { useTranslation } from 'react-i18next';

interface ConnectionCardProps {
  connection: ConnectionInfo;
  onEdit: (conn: ConnectionInfo) => void;
}

export default function ConnectionCard({ connection, onEdit }: ConnectionCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const { t, i18n } = useTranslation();

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    connected: { color: 'green', icon: <CheckCircleOutlined />, text: t('status.connected') },
    disconnected: { color: 'orange', icon: <QuestionCircleOutlined />, text: t('status.disconnected') },
    error: { color: 'red', icon: <CloseCircleOutlined />, text: t('status.error') },
    unknown: { color: 'default', icon: <QuestionCircleOutlined />, text: t('status.unknown') },
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
      message.error(t('msg.testFail'));
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteConnection(connection.name);
      message.success(t('msg.deleted'));
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || t('msg.deleteFail'));
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
          <strong>{t('connection.host')}</strong>{connection.host}:{connection.port}
        </div>
        <div>
          <strong>{t('connection.database')}</strong>{connection.database}
        </div>
        {connection.last_checked && (
          <div>
            <strong>{t('connection.lastChecked')}</strong>
            {new Date(connection.last_checked).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US')}
          </div>
        )}
        <Space style={{ marginTop: 8 }}>
          <Button
            type="primary"
            icon={<EyeOutlined />}
            onClick={handleBrowse}
          >
            {t('connection.browse')}
          </Button>
          <Button
            icon={testing ? undefined : <ReloadOutlined />}
            onClick={handleTest}
            loading={testing}
          >
            {t('connection.test')}
          </Button>
          <Button icon={<EditOutlined />} onClick={handleEdit}>
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('connection.deleteConfirm')}
            description={t('connection.deleteDesc')}
            onConfirm={handleDelete}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      </Space>
    </Card>
  );
}
