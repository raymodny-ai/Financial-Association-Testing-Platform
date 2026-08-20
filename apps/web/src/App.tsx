import { lazy, Suspense } from 'react';
import { Layout, Menu, Spin } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { appTheme } from './theme';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

// G7：路由级懒加载——页面代码按需拉取，首屏只下载框架壳 + vendor（关闭 N1）
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const ResultsPage = lazy(() => import('./pages/ResultsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const { Header, Content } = Layout;

/** 顶部导航（PRD 信息架构：新建分析 / 分析结果 / 历史任务 / 设置） */
const navItems = [
  { key: '/', label: <Link to="/">新建分析</Link> },
  { key: '/results', label: <Link to="/results">分析结果</Link> },
  { key: '/history', label: <Link to="/history">历史任务</Link> },
  { key: '/settings', label: <Link to="/settings">设置</Link> },
];

export default function App() {
  const location = useLocation();

  return (
    <ConfigProvider theme={appTheme} locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center' }}>
          <div className="font-display" style={{ color: 'var(--color-surface)', fontSize: 'var(--text-heading)', marginRight: 'var(--space-8)' }}>
            金融关联性检验平台
          </div>
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={[location.pathname]}
            items={navItems}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Header>
        <Content style={{ padding: 'var(--space-6)' }}>
          <Suspense fallback={<Spin style={{ display: 'block', margin: 'var(--space-8) auto' }} />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/results/:taskId" element={<ResultsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
