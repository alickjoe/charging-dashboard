import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Space, theme } from 'antd';
import {
  LinkOutlined,
  DatabaseOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useLanguageStore } from '../i18n/store';
import i18next from '../i18n';

const { Sider, Content, Header } = AntLayout;

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const menuItems = useMemo(() => [
    {
      key: '/connections',
      icon: <LinkOutlined />,
      label: t('nav.connections'),
    },
    {
      key: '/llm-configs',
      icon: <RobotOutlined />,
      label: t('nav.aiConfig'),
    },
    {
      key: '/nl-query',
      icon: <SearchOutlined />,
      label: t('nav.aiQuery'),
    },
  ], [t]);

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

  const handleToggleLanguage = () => {
    const next = language === 'zh' ? 'en' : 'zh';
    setLanguage(next);
    i18next.changeLanguage(next);
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        style={{ overflow: 'auto' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              flexShrink: 0,
            }}
          >
            {collapsed ? t('app.brandShort') : t('app.brand')}
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={getSelectedKeys()}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ flex: 1, overflow: 'auto' }}
          />
          {/* Language Switcher */}
          <div style={{
            flexShrink: 0,
            padding: '12px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
          }}>
            {collapsed ? (
              <Button
                type="text"
                block
                onClick={handleToggleLanguage}
                style={{ color: 'rgba(255,255,255,0.65)' }}
              >
                {language === 'zh' ? 'EN' : '中'}
              </Button>
            ) : (
              <Space style={{ width: '100%', justifyContent: 'center' }}>
                <Button
                  type={language === 'en' ? 'primary' : 'text'}
                  size="small"
                  onClick={handleToggleLanguage}
                  style={language !== 'en' ? { color: 'rgba(255,255,255,0.65)' } : undefined}
                  ghost={language === 'en'}
                >
                  EN
                </Button>
                <Button
                  type={language === 'zh' ? 'primary' : 'text'}
                  size="small"
                  onClick={handleToggleLanguage}
                  style={language !== 'zh' ? { color: 'rgba(255,255,255,0.65)' } : undefined}
                  ghost={language === 'zh'}
                >
                  中文
                </Button>
              </Space>
            )}
          </div>
        </div>
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
          {t('app.title')}
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
