import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ConnectionListPage from './pages/ConnectionListPage';
import DatabaseExplorerPage from './pages/DatabaseExplorerPage';
import ChartViewPage from './pages/ChartViewPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/connections" replace />} />
        <Route path="/connections" element={<ConnectionListPage />} />
        <Route path="/databases/:connectionName" element={<DatabaseExplorerPage />} />
        <Route path="/charts/:connectionName/:tableName" element={<ChartViewPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
