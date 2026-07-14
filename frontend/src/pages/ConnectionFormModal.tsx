import { Modal, Form, Input, InputNumber, Select, Button } from 'antd';
import { useState } from 'react';
import { createConnection, updateConnection, testTempConnection } from '../api/connections-admin';
import type { ConnectionInfo, CreateConnectionRequest } from '../types';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../components/Toast';

interface ConnectionFormModalProps {
  open: boolean;
  editingConnection: ConnectionInfo | null; // null = create mode
  onClose: () => void;
}

export default function ConnectionFormModal({ open, editingConnection, onClose }: ConnectionFormModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form] = Form.useForm<CreateConnectionRequest>();
  const [saving, setSaving] = useState(false);
  const [testingTemp, setTestingTemp] = useState(false);
  const queryClient = useQueryClient();

  const isEdit = !!editingConnection;

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTestingTemp(true);
      const result = await testTempConnection({
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        password: values.password,
        ssl_mode: values.ssl_mode,
        query_timeout: values.query_timeout,
      });
      if (result.status === 'connected') {
        toast.success(t('msg.testSuccess', { ms: result.latency_ms }));
      } else {
        toast.error(result.message);
      }
    } catch {
      // validation errors ignored
    } finally {
      setTestingTemp(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (isEdit) {
        await updateConnection(editingConnection!.name, values);
        toast.success(t('msg.updated'));
      } else {
        await createConnection(values);
        toast.success(t('msg.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      form.resetFields();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || t('msg.operationFail');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? t('connectionForm.editTitle') : t('connectionForm.createTitle')}
      open={open}
      onCancel={() => { form.resetFields(); onClose(); }}
      afterClose={() => form.resetFields()}
      footer={[
        <Button key="test" onClick={handleTest} loading={testingTemp}>
          {t('common.test')}
        </Button>,
        <Button key="cancel" onClick={() => { form.resetFields(); onClose(); }}>
          {t('common.cancel')}
        </Button>,
        <Button key="save" type="primary" onClick={handleSubmit} loading={saving}>
          {isEdit ? t('common.save') : t('common.add')}
        </Button>,
      ]}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          isEdit
            ? {
                name: editingConnection!.name,
                label: editingConnection!.label,
                host: editingConnection!.host,
                port: editingConnection!.port,
                database: editingConnection!.database,
                ssl_mode: 'prefer',
                pool_min: 2,
                pool_max: 10,
                pool_idle: 300,
                query_timeout: 30,
              }
            : { port: 5432, ssl_mode: 'prefer', pool_min: 2, pool_max: 10, pool_idle: 300, query_timeout: 30 }
        }
      >
        <Form.Item name="name" label={t('connectionForm.name')} rules={[{ required: true, message: t('validation.nameRequired') }]}>
          <Input placeholder={t('connectionForm.namePlaceholder')} disabled={isEdit} />
        </Form.Item>
        <Form.Item name="label" label={t('connectionForm.label')} rules={[{ required: true, message: t('validation.labelRequired') }]}>
          <Input placeholder={t('connectionForm.labelPlaceholder')} />
        </Form.Item>
        <Form.Item name="host" label={t('connectionForm.host')} rules={[{ required: true, message: t('validation.hostRequired') }]}>
          <Input placeholder={t('connectionForm.hostPlaceholder')} />
        </Form.Item>
        <Form.Item name="port" label={t('connectionForm.port')} rules={[{ required: true }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="database" label={t('connectionForm.database')} rules={[{ required: true, message: t('validation.databaseRequired') }]}>
          <Input placeholder={t('connectionForm.databasePlaceholder')} />
        </Form.Item>
        <Form.Item name="username" label={t('connectionForm.username')} rules={[{ required: true, message: t('validation.usernameRequired') }]}>
          <Input placeholder={t('connectionForm.usernamePlaceholder')} />
        </Form.Item>
        <Form.Item name="password" label={t('connectionForm.password')} rules={[{ required: true, message: t('validation.passwordRequired') }]}>
          <Input.Password placeholder={t('connectionForm.passwordPlaceholder')} />
        </Form.Item>
        <Form.Item name="ssl_mode" label={t('connectionForm.sslMode')}>
          <Select
            options={[
              { value: 'disable', label: t('connectionForm.sslDisable') },
              { value: 'allow', label: t('connectionForm.sslAllow') },
              { value: 'prefer', label: t('connectionForm.sslPrefer') },
              { value: 'require', label: t('connectionForm.sslRequire') },
            ]}
          />
        </Form.Item>
        <Form.Item name="pool_min" label={t('connectionForm.poolMin')}>
          <InputNumber min={1} max={50} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="pool_max" label={t('connectionForm.poolMax')}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="pool_idle" label={t('connectionForm.poolIdle')}>
          <InputNumber min={10} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="query_timeout" label={t('connectionForm.queryTimeout')}>
          <InputNumber min={1} max={300} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
