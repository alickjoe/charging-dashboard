import { useQuery } from '@tanstack/react-query';
import { Row, Col, Spin, Alert } from 'antd';
import { fetchConnections } from '../api/connections';
import ConnectionCard from '../components/ConnectionCard';

export default function ConnectionListPage() {
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

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="加载连接列表..." />
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

  if (!connections || connections.length === 0) {
    return (
      <Alert
        type="info"
        message="暂无数据库连接"
        description="请在 backend/config/databases.yaml 中配置数据库连接信息。"
        showIcon
      />
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>数据库连接管理</h2>
      <Row gutter={[16, 16]}>
        {connections.map((conn) => (
          <Col xs={24} sm={24} md={12} lg={8} key={conn.name}>
            <ConnectionCard connection={conn} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
