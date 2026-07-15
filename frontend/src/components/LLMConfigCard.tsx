import { Card, Tag, Button, Space, Popconfirm } from 'antd';
import {
  CheckCircleOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { testLLMConfig, deleteLLMConfig } from '../api/llm';
import type { LLMConfig } from '../types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from './Toast';

interface LLMConfigCardProps {
  config: LLMConfig;
  onEdit: (config: LLMConfig) => void;
}

export default function LLMConfigCard({ config, onEdit }: LLMConfigCardProps) {
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const { t } = useTranslation();
  const toast = useToast();

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testLLMConfig(config.id);
      if (result.status === 'ok') {
        toast.success(t('msg.testSuccess', { ms: result.latency_ms }), 5);
      } else {
        toast.error(t('msg.testFail'), 5);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || t('msg.testFail'), 5);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLLMConfig(config.id);
      toast.success(t('msg.deleted'));
      queryClient.invalidateQueries({ queryKey: ['llm-configs'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || t('msg.deleteFail'));
    }
  };

  return (
    <Card
      title={config.name}
      extra={
        config.is_default ? (
          <Tag color="blue">{t('llm.default')}</Tag>
        ) : null
      }
      style={{ width: '100%' }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <strong>{t('llm.apiBase')}: </strong>
          <span style={{ wordBreak: 'break-all' }}>{config.api_base}</span>
        </div>
        <div>
          <strong>{t('llm.apiKey')}: </strong>
          <code>{config.api_key_masked}</code>
        </div>
        <div>
          <strong>{t('llm.model')}: </strong>
          {config.model}
        </div>
        <Space wrap style={{ marginTop: 8 }}>
          <Button
            icon={<EditOutlined />}
            onClick={() => onEdit(config)}
          >
            {t('common.edit')}
          </Button>
          <Button
            icon={<CheckCircleOutlined />}
            onClick={handleTest}
            loading={testing}
          >
            {t('llm.test')}
          </Button>
          <Popconfirm
            title={t('llm.deleteConfirm')}
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
