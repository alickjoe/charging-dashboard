import { Modal, Form, Input, InputNumber, Select, Button, message } from 'antd';
import { useState } from 'react';
import { createConnection, updateConnection, testTempConnection } from '../api/connections-admin';
import type { ConnectionInfo, CreateConnectionRequest } from '../types';
import { useQueryClient } from '@tanstack/react-query';

interface ConnectionFormModalProps {
  open: boolean;
  editingConnection: ConnectionInfo | null; // null = create mode
  onClose: () => void;
}

export default function ConnectionFormModal({ open, editingConnection, onClose }: ConnectionFormModalProps) {
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
        message.success(`测试成功 (${result.latency_ms}ms)`);
      } else {
        message.error(result.message);
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
        message.success('连接已更新');
      } else {
        await createConnection(values);
        message.success('连接已创建');
      }
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      form.resetFields();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '操作失败';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑数据库连接' : '添加数据库连接'}
      open={open}
      onCancel={() => { form.resetFields(); onClose(); }}
      afterClose={() => form.resetFields()}
      footer={[
        <Button key="test" onClick={handleTest} loading={testingTemp}>
          测试连接
        </Button>,
        <Button key="cancel" onClick={() => { form.resetFields(); onClose(); }}>
          取消
        </Button>,
        <Button key="save" type="primary" onClick={handleSubmit} loading={saving}>
          {isEdit ? '保存' : '添加'}
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
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入连接名称' }]}>
          <Input placeholder="唯一标识，如 qa_pg" disabled={isEdit} />
        </Form.Item>
        <Form.Item name="label" label="标签" rules={[{ required: true, message: '请输入显示标签' }]}>
          <Input placeholder="如 QA 环境" />
        </Form.Item>
        <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机地址' }]}>
          <Input placeholder="如 localhost 或 xxx.postgres.database.azure.com" />
        </Form.Item>
        <Form.Item name="port" label="端口" rules={[{ required: true }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="database" label="数据库名" rules={[{ required: true, message: '请输入数据库名' }]}>
          <Input placeholder="如 charging_qa" />
        </Form.Item>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input placeholder="数据库用户名" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password placeholder="数据库密码" />
        </Form.Item>
        <Form.Item name="ssl_mode" label="SSL 模式">
          <Select
            options={[
              { value: 'disable', label: 'disable - 禁用 SSL' },
              { value: 'allow', label: 'allow - 尝试 SSL，失败则明文' },
              { value: 'prefer', label: 'prefer - 优先 SSL，失败则明文' },
              { value: 'require', label: 'require - 强制 SSL' },
            ]}
          />
        </Form.Item>
        <Form.Item name="pool_min" label="连接池最小连接数">
          <InputNumber min={1} max={50} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="pool_max" label="连接池最大连接数">
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="pool_idle" label="空闲超时 (秒)">
          <InputNumber min={10} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="query_timeout" label="查询超时 (秒)">
          <InputNumber min={1} max={300} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
