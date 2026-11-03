/**
 * AnswerBlocks — unified renderer for AI query answer blocks.
 *
 * Used by both the historical message list and the live streaming view so the
 * two can never drift apart.
 *
 * Layout rules:
 * - `summary` blocks are the conclusion area → pinned at the top, always visible.
 * - `think` / `sql` / `result` / `error` blocks (plus the live `think` string)
 *   form the process area. When `collapsible` is on AND a conclusion exists,
 *   the process area is folded behind one clickable "分析过程 · N 步" line
 *   (default collapsed, state kept inside this component only).
 * - Without a `summary` block (legacy conversations that only stored `think`)
 *   the blocks are rendered flat in their original order — folding them would
 *   leave an empty-looking answer.
 *
 * The fold state is intentionally NOT persisted: after a refresh historical
 * answers reopen collapsed, which is what "conclusion first" means here.
 */
import { memo, useState } from 'react';
import { Alert, Collapse, Tag, Typography } from 'antd';
import { CodeOutlined, TableOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import MarkdownRenderer from './Markdown';
import type { StreamBlock, StreamBlockType } from '../services/queryStreamManager';

const { Paragraph, Text } = Typography;

// ─── Mini Result Table ────────────────────────────────────────────

function MiniResultTable({ columns, rows, totalRows }: {
  columns: string[];
  rows: unknown[][];
  totalRows?: number;
}) {
  const { t } = useTranslation();
  if (!columns.length) return <Text type="secondary">{t('chat.noResults')}</Text>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse', width: '100%',
          fontSize: 13, fontFamily: 'monospace',
        }}
      >
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            {columns.map((col) => (
              <th key={col} style={{
                border: '1px solid #ddd', padding: '4px 8px',
                textAlign: 'left', fontWeight: 600,
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((val, ci) => (
                <td key={ci} style={{
                  border: '1px solid #eee', padding: '2px 8px',
                  maxWidth: 300, overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {val === null ? (
                    <span style={{ color: '#aaa' }}>NULL</span>
                  ) : String(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalRows !== undefined && totalRows > rows.length && (
        <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
          {t('chat.showingRows', { shown: rows.length, total: totalRows })}
        </Text>
      )}
    </div>
  );
}

// ─── Render a single block ────────────────────────────────────────

function BlockView({ block }: { block: StreamBlock }) {
  const { t } = useTranslation();
  switch (block.type) {
    case 'think':
      return (
        <div style={{ marginBottom: 16 }}>
          <MarkdownRenderer text={block.content} />
        </div>
      );
    case 'summary':
      // Final conclusion — shown exactly once (deduplicated against think blocks)
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <Tag color="success">{t('block.analysisDone')}</Tag>
          </div>
          <MarkdownRenderer text={block.content} />
        </div>
      );
    case 'sql':
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CodeOutlined style={{ color: '#1890ff' }} />
            <Text strong style={{ fontSize: 13 }}>{t('block.sqlQuery')}</Text>
          </div>
          <Paragraph
            copyable
            code
            style={{
              background: '#1e1e1e', color: '#d4d4d4',
              padding: 12, borderRadius: 6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            }}
          >
            {block.content}
          </Paragraph>
        </div>
      );
    case 'result':
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <TableOutlined style={{ color: '#52c41a' }} />
            <Text strong style={{ fontSize: 13 }}>{t('block.queryResult')}</Text>
            {block.totalRows !== undefined && <Tag>{t('block.rows', { count: block.totalRows })}</Tag>}
          </div>
          <MiniResultTable
            columns={block.columns || []}
            rows={block.rows || []}
            totalRows={block.totalRows}
          />
        </div>
      );
    case 'error':
      return (
        <Alert
          type="warning"
          message={block.content}
          showIcon
          style={{ marginBottom: 16 }}
        />
      );
    default:
      return null;
  }
}

export const MemoBlockView = memo(BlockView);

// ─── Parse answer_blocks JSON ─────────────────────────────────────

export function parseAnswerBlocks(raw: string): StreamBlock[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Merge consecutive think blocks to handle fragmented history data
    const merged: StreamBlock[] = [];
    for (const b of arr) {
      const blockType = (b.type as StreamBlockType) || 'think';
      if (blockType === 'think' && merged.length > 0 && merged[merged.length - 1].type === 'think') {
        merged[merged.length - 1].content += (b.content as string) || '';
      } else {
        merged.push({
          key: merged.length,
          type: blockType,
          // Older rows persist agent errors as ``{type:'error', message}`` while
          // the live stream uses ``content``; accept both so failures are not blank.
          content: (b.content as string) || (b.message as string) || '',
          columns: b.columns as string[] | undefined,
          rows: b.rows as unknown[][] | undefined,
          totalRows: b.total_rows as number | undefined,
        });
      }
    }
    return merged;
  } catch {
    return [];
  }
}

// ─── Answer renderer (conclusion first, process folded) ───────────

export interface AnswerBlocksProps {
  blocks: StreamBlock[];
  /** Live thinking text of a streaming query (kept separate from `blocks`). */
  think?: string;
  llmTimeMs?: number | null;
  /** Fold the process area. Streaming passes false while the query is active. */
  collapsible?: boolean;
}

function AnswerBlocksInner({ blocks, think, llmTimeMs, collapsible = false }: AnswerBlocksProps) {
  const { t } = useTranslation();
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  const summaryBlocks = blocks.filter((b) => b.type === 'summary');
  const processBlocks = blocks.filter((b) => b.type !== 'summary');
  const liveThink = think && think.trim() ? think : '';
  const steps = processBlocks.length + (liveThink ? 1 : 0);
  const foldable = collapsible && summaryBlocks.length > 0 && steps > 0;

  const processNodes = [
    ...processBlocks.map((block) => <MemoBlockView key={block.key} block={block} />),
    liveThink ? (
      <div key="live-think" style={{ marginBottom: 16 }}>
        <MarkdownRenderer text={liveThink} />
      </div>
    ) : null,
  ];

  const elapsedTag = llmTimeMs ? (
    <Tag color="blue" style={{ marginTop: 4 }}>{t('chat.llmTime', { time: llmTimeMs })}</Tag>
  ) : null;

  // Legacy answers (no summary block) keep the flat, fully expanded layout.
  if (!foldable) {
    return (
      <div>
        {summaryBlocks.map((block) => <MemoBlockView key={block.key} block={block} />)}
        {processNodes}
        {elapsedTag}
      </div>
    );
  }

  return (
    <div>
      {summaryBlocks.map((block) => <MemoBlockView key={block.key} block={block} />)}
      <Collapse
        ghost
        size="small"
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys as string])}
        style={{ background: '#fafafa', borderRadius: 6 }}
        items={[{
          key: 'process',
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 13 }}>{t('block.process')}</Text>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                {t('block.processSteps', { count: steps })}
                {llmTimeMs ? ` · ${t('chat.llmTime', { time: llmTimeMs })}` : ''}
              </Text>
            </span>
          ),
          children: <div style={{ paddingTop: 4 }}>{processNodes}</div>,
        }]}
      />
    </div>
  );
}

const AnswerBlocks = memo(AnswerBlocksInner);
export default AnswerBlocks;
