import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Row, Col, Modal, Form, Input, InputNumber, Switch, Button, Spin, Alert, Card, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { fetchLLMConfigs, createLLMConfig, updateLLMConfig, fetchAIQuerySettings, updateAIQuerySettings } from '../api/llm';
import type { AIQuerySettingsUpdate, AIQuerySettingsValues } from '../api/llm';
import LLMConfigCard from '../components/LLMConfigCard';
import type { LLMConfig, LLMConfigFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';

const { Text } = Typography;

// Small labelled wrapper for the global AI query settings fields.
function SettingField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      </div>
      {children}
      {hint ? (
        <div style={{ marginTop: 2 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{hint}</Text>
        </div>
      ) : null}
    </div>
  );
}

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

  // Global AI query settings (apply to every model / every AI query)
  const { data: aiSettings, isError: generalIsError } = useQuery({
    queryKey: ['ai-query-settings'],
    queryFn: fetchAIQuerySettings,
  });
  const [general, setGeneral] = useState<AIQuerySettingsValues | null>(null);

  useEffect(() => {
    if (aiSettings) setGeneral(aiSettings.values);
  }, [aiSettings]);

  const saveGeneralMutation = useMutation({
    mutationFn: (payload: AIQuerySettingsUpdate) => updateAIQuerySettings(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-query-settings'] });
      setGeneral(data.values);
      toast.success(t('llm.generalSettings.saved'));
    },
    onError: () => toast.error(t('llm.generalSettings.saveError')),
  });

  const setGeneralValue = (patch: Partial<AIQuerySettingsValues>) => {
    setGeneral((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  // Empty InputNumber -> fall back to the server default (never send null for these fields).
  const numberChange = (key: keyof AIQuerySettingsValues) => (value: number | null) => {
    const fallback = aiSettings?.defaults[key] ?? 0;
    setGeneralValue({ [key]: value ?? fallback } as Partial<AIQuerySettingsValues>);
  };

  const handleSaveGeneral = () => {
    if (general) saveGeneralMutation.mutate(general);
  };

  const handleResetGeneral = () => {
    if (aiSettings) setGeneral(aiSettings.defaults);
  };

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
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{t('llm.title')}</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('llm.add')}</Button>
      </div>

      {/* AI query settings shared by all models — see docs/specs/ai-query-limits-and-process-collapse.md */}
      <Card size="small" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <Text strong>{t('llm.generalSettings.title')}</Text>
            <div><Text type="secondary" style={{ fontSize: 12 }}>{t('llm.generalSettings.desc')}</Text></div>
          </div>
          <Space>
            <Button size="small" onClick={handleResetGeneral} disabled={!aiSettings}>
              {t('llm.generalSettings.reset')}
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={handleSaveGeneral}
              loading={saveGeneralMutation.isPending}
              disabled={!general}
            >
              {t('llm.generalSettings.save')}
            </Button>
          </Space>
        </div>
        {generalIsError ? (
          <Alert type="error" message={t('llm.generalSettings.loadError')} showIcon />
        ) : !general ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <Row gutter={[16, 12]}>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.maxRounds')}>
                <InputNumber
                  min={1}
                  max={2000}
                  style={{ width: '100%' }}
                  value={general.max_rounds}
                  onChange={numberChange('max_rounds')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField
                label={t('llm.generalSettings.maxToolCalls')}
                hint={t('llm.generalSettings.maxToolCallsHint')}
              >
                <InputNumber
                  min={10}
                  max={3000}
                  style={{ width: '100%' }}
                  value={general.max_tool_calls}
                  onChange={numberChange('max_tool_calls')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField
                label={t('llm.generalSettings.maxQuerySeconds')}
                hint={t('llm.generalSettings.maxQuerySecondsHint')}
              >
                <InputNumber
                  min={60}
                  max={7200}
                  style={{ width: '100%' }}
                  value={general.max_query_seconds}
                  onChange={numberChange('max_query_seconds')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.maxTokens')}>
                <InputNumber
                  min={1}
                  max={32768}
                  style={{ width: '100%' }}
                  placeholder={t('llm.generalSettings.maxTokensPlaceholder')}
                  value={general.max_tokens}
                  onChange={(value) => setGeneralValue({ max_tokens: value })}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.requestTimeout')}>
                <InputNumber
                  min={10}
                  max={1800}
                  style={{ width: '100%' }}
                  value={general.request_timeout_sec}
                  onChange={numberChange('request_timeout_sec')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.maxResultRows')}>
                <InputNumber
                  min={10}
                  max={1000}
                  style={{ width: '100%' }}
                  value={general.max_result_rows}
                  onChange={numberChange('max_result_rows')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.autoContinue')} hint={t('llm.generalSettings.autoContinueHint')}>
                <InputNumber
                  min={0}
                  max={5}
                  style={{ width: '100%' }}
                  value={general.auto_continue_rounds}
                  onChange={numberChange('auto_continue_rounds')}
                />
              </SettingField>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <SettingField label={t('llm.generalSettings.maxHistory')} hint={t('llm.generalSettings.maxHistoryHint')}>
                <InputNumber
                  min={0}
                  max={200}
                  style={{ width: '100%' }}
                  value={general.max_history_messages}
                  onChange={numberChange('max_history_messages')}
                />
              </SettingField>
            </Col>
          </Row>
        )}
      </Card>

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
