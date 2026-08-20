import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// 字体（自托管，避免外部 CDN 依赖）
import '@fontsource-variable/archivo';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-mono/400.css';
// 设计 Token 唯一样式来源（禁止硬编码色值/字体/间距）
import '@platform/ui/tokens.css';
// 页面级补充样式（一律引用 Token 变量）
import './app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 长任务轮询场景由各自 hook 覆写 refetchInterval
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
