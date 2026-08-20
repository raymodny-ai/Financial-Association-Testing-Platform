import { Layout, Menu } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { appTheme } from './theme';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import HistoryPage from './pages/HistoryPage';
import HomePage from './pages/HomePage';
import ResultsPage from './pages/ResultsPage';
import SettingsPage from './pages/SettingsPage';

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
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/results/:taskId" element={<ResultsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
