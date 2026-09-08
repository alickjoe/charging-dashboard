import { Modal, Form, Input, InputNumber, Select, Button, Switch, Typography } from 'antd';
import { useState, useEffect } from 'react';
import { createConnection, updateConnection, testTempConnection } from '../api/connections-admin';
import { testConnection } from '../api/connections';
import type { ConnectionInfo, CreateConnectionRequest, UpdateConnectionRequest } from '../types';
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
  const tunnelMode = Form.useWatch('tunnel_mode', form) ?? false;

  // Populate the form whenever the modal opens. A plain `initialValues`
  // snapshot is not enough: after a previous open/close cycle the form
  // store keeps stale values, so we must reset them explicitly. Credentials
  // are never echoed — blank means "keep the stored value".
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      isEdit
        ? {
            name: editingConnection!.name,
            label: editingConnection!.label,
            host: editingConnection!.host,
            port: editingConnection!.port,
            database: editingConnection!.database,
            ssl_mode: editingConnection!.ssl_mode,
            pool_min: editingConnection!.pool_min,
            pool_max: editingConnection!.pool_max,
            pool_idle: editingConnection!.pool_idle,
            query_timeout: editingConnection!.query_timeout,
            tunnel_mode: !!editingConnection!.tunnel_mode,
            tunnel_path: editingConnection!.tunnel_path || '/pgwss',
            tunnel_port: editingConnection!.tunnel_port || 443,
            tunnel_auth_user: editingConnection!.tunnel_auth_user || undefined,
            tunnel_auth_password: undefined,
            username: undefined,
            password: undefined,
          }
        : {
            name: undefined,
            label: undefined,
            host: undefined,
            database: undefined,
            port: 5432,
            ssl_mode: 'prefer',
            pool_min: 2,
            pool_max: 10,
            pool_idle: 300,
            query_timeout: 30,
            tunnel_mode: false,
            tunnel_path: '/pgwss',
            tunnel_port: 443,
            tunnel_auth_user: undefined,
            tunnel_auth_password: undefined,
            username: undefined,
            password: undefined,
          }
    );
  }, [open, form, isEdit, editingConnection]);

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTestingTemp(true);
      // In edit mode, when username/password is left blank, test with the
      // stored credentials instead of the incomplete form values.
      if (isEdit && (!values.username || !values.password)) {
        const result = await testConnection(editingConnection!.name);
        if (result.status === 'connected') {
          toast.success(t('msg.testSuccess', { ms: result.latency_ms }));
        } else {
          toast.error(result.message || t('msg.testFail'));
        }
        return;
      }
      const result = await testTempConnection({
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        password: values.password,
        ssl_mode: values.ssl_mode,
        query_timeout: values.query_timeout,
        tunnel_mode: !!values.tunnel_mode,
        tunnel_path: values.tunnel_path,
        tunnel_port: values.tunnel_port,
        tunnel_auth_user: values.tunnel_auth_user,
        tunnel_auth_password: values.tunnel_auth_password,
      });
      if (result.status === 'connected') {
        toast.success(t('msg.testSuccess', { ms: result.latency_ms }));
      } else {
        toast.error(result.message || t('msg.testFail'));
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
        // Blank username/password means "keep the stored value", so omit
        // them from the payload instead of overwriting with empty strings.
        const payload: UpdateConnectionRequest = { ...values };
        if (!payload.username) delete payload.username;
        if (!payload.password) delete payload.password;
        if (!payload.tunnel_auth_password) delete payload.tunnel_auth_password;
        await updateConnection(editingConnection!.name, payload);
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
      onCancel={onClose}
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
      destroyOnClose
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
                ssl_mode: editingConnection!.ssl_mode,
                pool_min: editingConnection!.pool_min,
                pool_max: editingConnection!.pool_max,
                pool_idle: editingConnection!.pool_idle,
                query_timeout: editingConnection!.query_timeout,
                tunnel_mode: !!editingConnection!.tunnel_mode,
                tunnel_path: editingConnection!.tunnel_path || '/pgwss',
                tunnel_port: editingConnection!.tunnel_port || 443,
              }
            : { port: 5432, ssl_mode: 'prefer', pool_min: 2, pool_max: 10, pool_idle: 300, query_timeout: 30, tunnel_mode: false, tunnel_path: '/pgwss', tunnel_port: 443 }
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
        <Form.Item name="username" label={t('connectionForm.username')} rules={isEdit ? [] : [{ required: true, message: t('validation.usernameRequired') }]}>
          <Input placeholder={isEdit ? t('connectionForm.usernameEditPlaceholder') : t('connectionForm.usernamePlaceholder')} />
        </Form.Item>
        <Form.Item name="password" label={t('connectionForm.password')} rules={isEdit ? [] : [{ required: true, message: t('validation.passwordRequired') }]}>
          <Input.Password placeholder={isEdit ? t('connectionForm.passwordEditPlaceholder') : t('connectionForm.passwordPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="tunnel_mode"
          label={t('connectionForm.tunnelMode')}
          valuePropName="checked"
          tooltip={t('connectionForm.tunnelModeHint')}
        >
          <Switch />
        </Form.Item>
        {tunnelMode && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12, marginTop: -4 }}>
              {t('connectionForm.tunnelHint')}
            </Typography.Paragraph>
            <Form.Item name="tunnel_path" label={t('connectionForm.tunnelPath')} rules={[{ required: true, message: t('validation.tunnelPathRequired') }]}>
              <Input placeholder="/pgwss" />
            </Form.Item>
            <Form.Item name="tunnel_port" label={t('connectionForm.tunnelPort')} rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="tunnel_auth_user" label={t('connectionForm.tunnelAuthUser')}>
              <Input placeholder={t('connectionForm.tunnelAuthOptional')} />
            </Form.Item>
            <Form.Item name="tunnel_auth_password" label={t('connectionForm.tunnelAuthPassword')}>
              <Input.Password placeholder={isEdit ? t('connectionForm.tunnelAuthEditPlaceholder') : t('connectionForm.tunnelAuthOptional')} />
            </Form.Item>
          </>
        )}
        <Form.Item name="ssl_mode" label={t('connectionForm.sslMode')} extra={tunnelMode ? t('connectionForm.sslModeTunnelExtra') : undefined}>
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
