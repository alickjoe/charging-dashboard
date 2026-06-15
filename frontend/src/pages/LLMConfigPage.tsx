import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, Space, Tag, Popconfirm, message, Spin, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { fetchLLMConfigs, createLLMConfig, updateLLMConfig, deleteLLMConfig, testLLMConfig } from '../api/llm';
import type { LLMConfig, LLMConfigFormData } from '../types';

export default function LLMConfigPage() {
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
      message.success('配置已删除');
      queryClient.invalidateQueries({ queryKey: ['llm-configs'] });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const result = await testLLMConfig(id);
      if (result.status === 'ok') {
        message.success(`${result.message} (${result.latency_ms}ms)`);
      } else {
        message.error(result.message);
      }
    } catch {
      message.error('测试失败');
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
        message.success('配置已更新');
      } else {
        await createLLMConfig(values);
        message.success('配置已创建');
      }
      queryClient.invalidateQueries({ queryKey: ['llm-configs'] });
      setModalOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '操作失败';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: 'API Base', dataIndex: 'api_base', key: 'api_base', ellipsis: true },
    {
      title: 'API Key',
      dataIndex: 'api_key_masked',
      key: 'api_key_masked',
      width: 150,
      render: (v: string) => <code>{v}</code>,
    },
    { title: '模型', dataIndex: 'model', key: 'model', width: 120 },
    {
      title: '默认',
      dataIndex: 'is_default',
      key: 'is_default',
      width: 70,
      render: (v: boolean) => v ? <Tag color="blue">默认</Tag> : null,
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: LLMConfig) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Button
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => handleTest(record.id)}
            loading={testingId === record.id}
          >
            测试
          </Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>AI 大模型配置</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加配置</Button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : isError ? (
        <Alert type="error" message="加载失败" showIcon />
      ) : (
        <Table
          dataSource={configs}
          columns={columns}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: '暂无 LLM 配置，点击右上角添加' }}
        />
      )}

      <Modal
        title={editingConfig ? '编辑 LLM 配置' : '添加 LLM 配置'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 OpenAI GPT-4o" />
          </Form.Item>
          <Form.Item name="api_base" label="API Base URL" rules={[{ required: true, message: '请输入 API 地址' }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key" rules={[{ required: !editingConfig, message: '请输入 API Key' }]}>
            <Input.Password placeholder={editingConfig ? '留空则不修改' : 'sk-...'} />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
            <Input placeholder="gpt-4o" />
          </Form.Item>
          <Form.Item name="temperature" label="Temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_tokens" label="Max Tokens">
            <InputNumber min={1} max={32768} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_default" label="设为默认" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
