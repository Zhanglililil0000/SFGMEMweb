import { lazy, Suspense, useState } from 'react'
import { Layout, Typography, Tabs, Spin } from 'antd'

const MemAnalyzerPage = lazy(() => import('./pages/MemAnalyzerPage'))
const MemVsFittingPage = lazy(() => import('./pages/MemVsFittingPage'))
const SfgGeneratorPage = lazy(() => import('./pages/SfgGeneratorPage'))
const FittingAnalysisPage = lazy(() => import('./pages/FittingAnalysisPage'))

const { Header, Content } = Layout
const { Text } = Typography

const tabItems = [
  { key: 'mem', label: 'MEM Analyzer' },
  { key: 'sfg', label: 'SFG Generator' },
  { key: 'fitting', label: 'MEM vs Fitting' },
  { key: 'fitting-analysis', label: 'Fitting Analysis' },
]

function App() {
  const [activeTab, setActiveTab] = useState('mem')

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <style>{`
        .header-tabs .ant-tabs-tab {
          color: rgba(255, 255, 255, 0.65) !important;
          font-size: 14px;
        }
        .header-tabs .ant-tabs-tab:hover {
          color: rgba(255, 255, 255, 0.85) !important;
        }
        .header-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #fff !important;
        }
        .header-tabs .ant-tabs-ink-bar {
          background: #1677ff !important;
        }
      `}</style>
      <Header
        style={{
          background: '#001529',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          height: 48,
        }}
      >
        <Text strong style={{ color: '#fff', fontSize: 18, marginRight: 24, whiteSpace: 'nowrap' }}>
          MEM Analyzer
        </Text>
        <Tabs
          className="header-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          style={{ flex: 1, marginBottom: 0 }}
          tabBarStyle={{ marginBottom: 0 }}
        />
      </Header>

      <Content style={{ padding: '16px 24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>}>
          {activeTab === 'mem' && <MemAnalyzerPage />}
          {activeTab === 'fitting' && <MemVsFittingPage />}
          {activeTab === 'sfg' && <SfgGeneratorPage />}
          {activeTab === 'fitting-analysis' && <FittingAnalysisPage />}
        </Suspense>
      </Content>
    </Layout>
  )
}

export default App
