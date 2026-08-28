import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Typography } from 'antd';

const { Text } = Typography;

/**
 * Unified markdown renderer for AI conversation output (thinking blocks,
 * streaming text and the final conclusion).
 *
 * - remark-gfm: tables, strikethrough, task lists, autolinks
 * - remark-breaks: single newlines render as line breaks (chat style)
 * - Raw HTML is escaped by default (XSS-safe)
 * - Visual style mirrors the legacy hand-rolled renderer: grey-header
 *   bordered tables, dark monospace code blocks (same as the SQL block),
 *   compact headings and antd-style inline code.
 */

const MONO_FONT = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

const headingStyle = (fontSize: number): React.CSSProperties => ({
  fontSize,
  fontWeight: 600,
  lineHeight: 1.4,
  margin: '16px 0 8px',
});

const preStyle: React.CSSProperties = {
  background: '#1e1e1e',
  color: '#d4d4d4',
  padding: 12,
  borderRadius: 6,
  overflowX: 'auto',
  margin: '0 0 8px',
  fontSize: 13,
  fontFamily: MONO_FONT,
  lineHeight: 1.5,
  whiteSpace: 'pre',
  wordBreak: 'break-all',
};

const components: Components = {
  h1: ({ children }) => <h1 style={headingStyle(18)}>{children}</h1>,
  h2: ({ children }) => <h2 style={headingStyle(16)}>{children}</h2>,
  h3: ({ children }) => <h3 style={headingStyle(15)}>{children}</h3>,
  h4: ({ children }) => <h4 style={headingStyle(14)}>{children}</h4>,
  h5: ({ children }) => <h5 style={headingStyle(14)}>{children}</h5>,
  h6: ({ children }) => <h6 style={headingStyle(14)}>{children}</h6>,
  p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0 0 8px',
        padding: '2px 0 2px 12px',
        borderLeft: '3px solid #d9d9d9',
        color: '#595959',
      }}
    >
      {children}
    </blockquote>
  ),
  a: ({ node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff' }}>
      {children}
    </a>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '12px 0' }} />,
  img: ({ node, ...props }) => <img {...props} style={{ maxWidth: '100%' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontFamily: MONO_FONT }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: '1px solid #ddd',
        padding: '4px 8px',
        textAlign: 'left',
        fontWeight: 600,
        background: '#f0f0f0',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        border: '1px solid #eee',
        padding: '2px 8px',
        maxWidth: 300,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </td>
  ),
  pre: ({ children }) => {
    // Fenced code block: rebuild from the raw code string so block-level
    // code never picks up the inline-code style (even without a language tag).
    const first: unknown = Array.isArray(children) ? children[0] : children;
    const innerProps = (first as { props?: { children?: unknown } } | undefined)?.props;
    const raw = innerProps?.children;
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('') : '';
    return <pre style={preStyle}>{text !== '' ? <code>{text}</code> : children}</pre>;
  },
  code: ({ children }) => (
    <Text code style={{ fontSize: '0.95em', wordBreak: 'break-word' }}>
      {children}
    </Text>
  ),
};

function MarkdownRendererBase({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Memoized: re-renders only when the markdown text changes (streaming-friendly). */
const MarkdownRenderer = memo(MarkdownRendererBase);
export default MarkdownRenderer;
