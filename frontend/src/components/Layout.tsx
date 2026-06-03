import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, theme } from 'antd';
import {
  LinkOutlined,
  DatabaseOutlined,
  BarChartOutlined,
} from '@ant-design/icons';

const { Sider, Content, Header } = AntLayout;

const menuItems = [
  {
    key: '/connections',
    icon: <LinkOutlined />,
    label: '连接管理',
  },
  {
    key: 'databases-group',
    icon: <DatabaseOutlined />,
    label: '数据库浏览',
    children: [],
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

  // Highlight connections page or database explorer page
  const getSelectedKeys = () => {
    if (location.pathname === '/connections') return ['/connections'];
    if (location.pathname.startsWith('/databases/')) return ['/connections'];
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
