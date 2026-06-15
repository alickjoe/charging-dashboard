import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, theme } from 'antd';
import {
  LinkOutlined,
  DatabaseOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';

const { Sider, Content, Header } = AntLayout;

const menuItems = [
  {
    key: '/connections',
    icon: <LinkOutlined />,
    label: '连接管理',
  },
  {
    key: '/llm-configs',
    icon: <RobotOutlined />,
    label: 'AI 配置',
  },
  {
    key: '/nl-query',
    icon: <SearchOutlined />,
    label: 'AI 查询',
  },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const handleMenuClick = (e: { key: string }) => {
    if (e.key.startsWith('/')) {
      navigate(e.key);
    }
  };

  const getSelectedKeys = () => {
    const path = location.pathname;
    if (path === '/connections') return ['/connections'];
    if (path === '/llm-configs') return ['/llm-configs'];
    if (path === '/nl-query') return ['/nl-query'];
    if (path.startsWith('/databases/') || path.startsWith('/charts/')) return ['/connections'];
    return [];
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: collapsed ? 14 : 18,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? '⚡' : '充电看板'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={getSelectedKeys()}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <AntLayout>
        <Header
          style={{
            padding: '0 24px',
            background: token.colorBgContainer,
            fontSize: 16,
            fontWeight: 500,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          EV 充电桩数据看板
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
