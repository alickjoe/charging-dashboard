import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import FirstRunGuide from './components/FirstRunGuide';
import ConnectionListPage from './pages/ConnectionListPage';
import DatabaseExplorerPage from './pages/DatabaseExplorerPage';
import ChartViewPage from './pages/ChartViewPage';
import LLMConfigPage from './pages/LLMConfigPage';
import NLQueryPage from './pages/NLQueryPage';
import CustomQueryPage from './pages/CustomQueryPage';
import SkillsPage from './pages/SkillsPage';

function App() {
  return (
    <FirstRunGuide>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/connections" replace />} />
          <Route path="/connections" element={<ConnectionListPage />} />
          <Route path="/llm-configs" element={<LLMConfigPage />} />
          <Route path="/nl-query" element={<NLQueryPage />} />
          <Route path="/databases/:connectionName" element={<DatabaseExplorerPage />} />
          <Route path="/charts/:connectionName/:schema/:tableName" element={<ChartViewPage />} />
          <Route path="/queries/:connectionName" element={<CustomQueryPage />} />
          <Route path="/skills" element={<SkillsPage />} />
        </Routes>
      </Layout>
    </FirstRunGuide>
  );
}

export default App;
