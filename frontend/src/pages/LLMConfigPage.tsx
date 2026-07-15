import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, Space, Tag, Popconfirm, Spin, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { fetchLLMConfigs, createLLMConfig, updateLLMConfig, deleteLLMConfig, testLLMConfig } from '../api/llm';
import type { LLMConfig, LLMConfigFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';

export default function LLMConfigPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null);
  const [form] = Form.useForm<LLMConfigFormData>();
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const { data: configs, isLoading, isError } = useQuery({
    queryKey: ['llm-configs'],
    queryFn: fetchLLMConfigs,
  });

  const handleAdd = () => {
    setEditingConfig(null);
    form.resetFields();
    form.setFieldsValue({ temperature: 0.1, max_tokens: 4096, is_default: false, model: 'gpt-4o' });
    setModalOpen(true);
  };

  const handleEdit = (cfg: LLMConfig) => {
    setEditingConfig(cfg);
    form.setFieldsValue({
      name: cfg.name,
      api_base: cfg.api_base,
      api_key: '',
      model: cfg.model,
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
      is_default: cfg.is_default,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLLMConfig(id);
      toast.success(t('msg.deleted'));
      queryClient.invalidateQueries({ queryKey: ['llm-configs'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || t('msg.deleteFail'));
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testLLMConfig(id);
      console.log('[LLM Test] result:', result);
      if (result.status === 'ok') {
        toast.success(t('msg.testSuccess', { ms: result.latency_ms }), 5);
      } else {
        toast.error(t('msg.testFail'), 5);
      }
    } catch (err: any) {
      console.error('[LLM Test] error:', err);
      toast.error(err?.response?.data?.detail || t('msg.testFail'), 5);
    } finally {
      setTestingId(null);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingConfig) {
        const payload: Partial<LLMConfigFormData> = { ...values };
        if (!payload.api_key) delete payload.api_key; // don't send empty key
        await updateLLMConfig(editingConfig.id, payload);
        toast.success(t('msg.updated'));
      } else {
        await createLLMConfig(values);
        toast.success(t('msg.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['llm-configs'] });
      setModalOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || t('msg.operationFail');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: t('llm.name'), dataIndex: 'name', key: 'name', width: 150 },
    { title: t('llm.apiBase'), dataIndex: 'api_base', key: 'api_base', ellipsis: true },
    {
      title: t('llm.apiKey'),
      dataIndex: 'api_key_masked',
      key: 'api_key_masked',
      width: 150,
      render: (v: string) => <code>{v}</code>,
    },
    { title: t('llm.model'), dataIndex: 'model', key: 'model', width: 120 },
    {
      title: t('llm.default'),
      dataIndex: 'is_default',
      key: 'is_default',
      width: 70,
      render: (v: boolean) => v ? <Tag color="blue">{t('llm.default')}</Tag> : null,
    },
    {
      title: t('llm.actions'),
      key: 'actions',
      width: 240,
      render: (_: unknown, record: LLMConfig) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => handleTest(record.id)}
            loading={testingId === record.id}
          >
            {t('llm.test')}
          </Button>
          <Popconfirm title={t('llm.deleteConfirm')} onConfirm={() => handleDelete(record.id)} okText={t('common.delete')} cancelText={t('common.cancel')}>
            <Button size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('llm.title')}</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('llm.add')}</Button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : isError ? (
        <Alert type="error" message={t('common.loadError')} showIcon />
      ) : (
        <Table
          dataSource={configs}
          columns={columns}
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t('llm.empty') }}
        />
      )}

      <Modal
        title={editingConfig ? t('llm.editTitle') : t('llm.createTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('llm.name')} rules={[{ required: true, message: t('validation.nameRequired') }]}>
            <Input placeholder={t('llm.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="api_base" label={t('llm.apiBase')} rules={[{ required: true, message: t('validation.apiBaseRequired') }]}>
            <Input placeholder={t('llm.apiBasePlaceholder')} />
          </Form.Item>
          <Form.Item name="api_key" label={t('llm.apiKey')} rules={[{ required: !editingConfig, message: t('validation.apiKeyRequired') }]}>
            <Input.Password placeholder={editingConfig ? t('connectionForm.passwordEditPlaceholder') : t('llm.apiKeyPlaceholder')} />
          </Form.Item>
          <Form.Item name="model" label={t('llm.model')} rules={[{ required: true }]}>
            <Input placeholder={t('llm.modelPlaceholder')} />
          </Form.Item>
          <Form.Item name="temperature" label={t('llm.temperature')}>
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_tokens" label={t('llm.maxTokens')}>
            <InputNumber min={1} max={32768} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_default" label={t('llm.setDefault')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
