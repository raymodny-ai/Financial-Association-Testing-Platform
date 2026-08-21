import { lazy, Suspense } from 'react';
import { Layout, Menu, Spin } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { appTheme } from './theme';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

// G7：路由级懒加载——页面代码按需拉取，首屏只下载框架壳 + vendor（关闭 N1）
const DatasetsPage = lazy(() => import('./pages/DatasetsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ResultsPage = lazy(() => import('./pages/ResultsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));

const { Header, Content } = Layout;

/** 顶部导航（X5：对齐 PRD 信息架构七项） */
const navItems = [
  { key: '/workspace', label: <Link to="/workspace">工作区</Link> },
  { key: '/', label: <Link to="/">新建分析</Link> },
  { key: '/datasets', label: <Link to="/datasets">数据集</Link> },
  { key: '/results', label: <Link to="/results">分析结果</Link> },
  { key: '/reports', label: <Link to="/reports">报告</Link> },
  { key: '/history', label: <Link to="/history">历史任务</Link> },
  { key: '/settings', label: <Link to="/settings">设置</Link> },
];

/** 高亮归属：/results/:taskId 归入分析结果；/ 首页精确匹配 */
function navSelectedKey(pathname: string): string {
  if (pathname.startsWith('/results')) return '/results';
  const hit = navItems.find((item) => item.key !== '/' && pathname.startsWith(item.key));
  return hit?.key ?? '/';
}

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
            selectedKeys={[navSelectedKey(location.pathname)]}
            items={navItems}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Header>
        <Content style={{ padding: 'var(--space-6)' }}>
          <Suspense fallback={<Spin style={{ display: 'block', margin: 'var(--space-8) auto' }} />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/results/:taskId" element={<ResultsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
