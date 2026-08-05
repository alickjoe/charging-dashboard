import { useEffect, useState } from 'react';
import { Button, Result, Spin } from 'antd';
import { LinkOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchSetupStatus } from '../api/setup';

/**
 * First-run gate: when the backend has no database connection and no LLM
 * config yet, show a full-screen guide asking the user to enter credentials
 * before entering the app. It re-checks on every navigation, so the guide
 * disappears automatically once setup is complete.
 */
export default function FirstRunGuide({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((status) => {
        if (cancelled) return;
        setNeedsSetup(status.needs_setup);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!checked) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (needsSetup && !dismissed) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
        }}
      >
        <Result
          icon={<RocketOutlined style={{ color: '#1677ff' }} />}
          title={t('setup.title')}
          subTitle={t('setup.subtitle')}
          extra={[
            <Button
              type="primary"
              key="connection"
              icon={<LinkOutlined />}
              onClick={() => {
                setDismissed(true);
                navigate('/connections');
              }}
            >
              {t('setup.configureConnection')}
            </Button>,
            <Button
              key="llm"
              icon={<RobotOutlined />}
              onClick={() => {
                setDismissed(true);
                navigate('/llm-configs');
              }}
            >
              {t('setup.configureLLM')}
            </Button>,
            <Button type="link" key="later" onClick={() => setDismissed(true)}>
              {t('setup.later')}
            </Button>,
          ]}
        />
      </div>
    );
  }

  return <>{children}</>;
}
