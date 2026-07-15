import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Row, Col, Modal, Form, Input, InputNumber, Switch, Button, Spin, Alert } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { fetchLLMConfigs, createLLMConfig, updateLLMConfig } from '../api/llm';
import LLMConfigCard from '../components/LLMConfigCard';
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

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingConfig) {
        const payload: Partial<LLMConfigFormData> = { ...values };
        if (!payload.api_key) delete payload.api_key;
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
      ) : (!configs || configs.length === 0) ? (
        <Alert
          type="info"
          message={t('llm.empty')}
          showIcon
        />
      ) : (
        <Row gutter={[16, 16]}>
          {configs.map((cfg) => (
            <Col xs={24} sm={24} md={12} lg={8} key={cfg.id}>
              <LLMConfigCard config={cfg} onEdit={handleEdit} />
            </Col>
          ))}
        </Row>
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
