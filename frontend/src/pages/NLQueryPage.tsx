import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Input, Button, Card, Space, Spin, Alert, Typography, Divider } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { fetchConnections } from '../api/connections';
import { fetchLLMConfigs, executeNLQuery } from '../api/llm';
import DataTable from '../components/DataTable';
import type { NLQueryResponse, ConnectionInfo, LLMConfig } from '../types';

const { TextArea } = Input;
const { Paragraph } = Typography;

export default function NLQueryPage() {
  const [selectedConn, setSelectedConn] = useState<string | undefined>();
  const [selectedLLM, setSelectedLLM] = useState<number | undefined>();
  const [question, setQuestion] = useState('');
  const [querying, setQuerying] = useState(false);
  const [result, setResult] = useState<NLQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: connections, isLoading: loadingConns } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 60000,
  });

  const { data: llmConfigs, isLoading: loadingLLMs } = useQuery({
    queryKey: ['llm-configs'],
    queryFn: fetchLLMConfigs,
  });

  const connectedConns = (connections || []).filter((c: ConnectionInfo) => c.status === 'connected');

  const handleQuery = async () => {
    if (!selectedConn || !selectedLLM || !question.trim()) return;
    setQuerying(true);
    setError(null);
    setResult(null);
    try {
      const res = await executeNLQuery({
        connection_name: selectedConn,
        llm_config_id: selectedLLM,
        question: question.trim(),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '查询失败');
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>AI 自然语言查询</h2>

      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <span style={{ fontWeight: 500 }}>数据库：</span>
            <Select
              placeholder="选择数据库连接"
              value={selectedConn}
              onChange={(v) => setSelectedConn(v)}
              loading={loadingConns}
              style={{ minWidth: 280 }}
              options={connectedConns.map((c: ConnectionInfo) => ({
                value: c.name,
                label: `${c.label} (${c.database})`,
              }))}
              notFoundContent={loadingConns ? <Spin size="small" /> : '无可用连接'}
            />
            <span style={{ fontWeight: 500, marginLeft: 16 }}>AI 模型：</span>
            <Select
              placeholder="选择 AI 模型"
              value={selectedLLM}
              onChange={(v) => setSelectedLLM(v)}
              loading={loadingLLMs}
              style={{ minWidth: 200 }}
              options={(llmConfigs || []).map((c: LLMConfig) => ({
                value: c.id,
                label: `${c.name} (${c.model})`,
              }))}
              notFoundContent={loadingLLMs ? <Spin size="small" /> : '无 LLM 配置'}
            />
          </Space>

          <TextArea
            placeholder="用自然语言描述你想查询的数据，例如：统计每个充电站的总充电量，按从高到低排序"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            disabled={querying}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleQuery(); } }}
          />

          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleQuery}
            loading={querying}
            disabled={!selectedConn || !selectedLLM || !question.trim()}
          >
            查询
          </Button>
        </Space>
      </Card>

      {error && (
        <Alert type="error" message="查询失败" description={error} showIcon style={{ marginBottom: 24 }} closable />
      )}

      {querying && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" tip="AI 正在分析并生成 SQL..." />
        </div>
      )}

      {result && !querying && (
        <div>
          {result.cannot_answer ? (
            <Alert
              type="warning"
              message="AI 无法回答"
              description={result.cannot_answer}
              showIcon
            />
          ) : (
            <>
              <Card title="生成的 SQL" style={{ marginBottom: 24 }}>
                <Paragraph
                  copyable
                  code
                  style={{
                    background: '#f5f5f5',
                    padding: 16,
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                  }}
                >
                  {result.sql}
                </Paragraph>
                <Divider style={{ margin: '12px 0' }} />
                <Space>
                  <span>LLM 耗时: {result.llm_call_time_ms}ms</span>
                  <span>SQL 执行耗时: {result.execution_time_ms}ms</span>
                </Space>
              </Card>

              <Card title="查询结果">
                {result.rows.length > 0 ? (
                  <DataTable
                    data={{
                      columns: result.columns,
                      rows: result.rows,
                      page: 1,
                      page_size: result.rows.length,
                      total_rows: result.rows.length,
                      total_pages: 1,
                    }}
                    loading={false}
                    onPageChange={() => {}}
                  />
                ) : (
                  <Alert type="info" message="查询无结果" showIcon />
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
