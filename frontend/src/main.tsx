import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './i18n';
import { useLanguageStore } from './i18n/store';
import { ToastProvider } from './components/Toast';

// Prevent body-level scrolling
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';

const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ === true;

function RouterWrapper({ children }: { children: React.ReactNode }) {
  return isElectron ? (
    <HashRouter>{children}</HashRouter>
  ) : (
    <BrowserRouter>{children}</BrowserRouter>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function LocaleWrapper({ children }: { children: React.ReactNode }) {
  const language = useLanguageStore((s) => s.language);
  const antdLocale = useMemo(() => (language === 'zh' ? zhCN : enUS), [language]);
  return <ConfigProvider locale={antdLocale}><AntdApp>{children}</AntdApp></ConfigProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <QueryClientProvider client={queryClient}>
      <RouterWrapper>
        <LocaleWrapper>
          <App />
        </LocaleWrapper>
      </RouterWrapper>
    </QueryClientProvider>
  </ToastProvider>
);
