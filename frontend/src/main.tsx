import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './i18n';
import { useLanguageStore } from './i18n/store';
import { ToastProvider } from './components/Toast';

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
      <BrowserRouter>
        <LocaleWrapper>
          <App />
        </LocaleWrapper>
      </BrowserRouter>
    </QueryClientProvider>
  </ToastProvider>
);
