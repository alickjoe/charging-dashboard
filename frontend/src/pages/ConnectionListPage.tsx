import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Spin, Alert, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { fetchConnections } from '../api/connections';
import ConnectionCard from '../components/ConnectionCard';
import ConnectionFormModal from './ConnectionFormModal';
import type { ConnectionInfo } from '../types';

export default function ConnectionListPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionInfo | null>(null);

  const {
    data: connections,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 30000,
  });

  const handleAdd = () => {
    setEditingConnection(null);
    setModalOpen(true);
  };

  const handleEdit = (conn: ConnectionInfo) => {
    setEditingConnection(conn);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingConnection(null);
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert
        type="error"
        message="加载失败"
        description={(error as Error)?.message || '无法获取数据库连接列表，请检查后端服务是否启动。'}
        showIcon
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>数据库连接管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加连接
        </Button>
      </div>

      {(!connections || connections.length === 0) ? (
        <Alert
          type="info"
          message="暂无数据库连接"
          description="点击右上角「添加连接」按钮配置 PostgreSQL 数据库连接。"
          showIcon
        />
      ) : (
        <Row gutter={[16, 16]}>
          {connections.map((conn) => (
            <Col xs={24} sm={24} md={12} lg={8} key={conn.name}>
              <ConnectionCard connection={conn} onEdit={handleEdit} />
            </Col>
          ))}
        </Row>
      )}

      <ConnectionFormModal
        open={modalOpen}
        editingConnection={editingConnection}
        onClose={handleCloseModal}
      />
    </div>
  );
}
