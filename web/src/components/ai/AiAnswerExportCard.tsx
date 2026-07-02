import { cleanSourceText, getAiSourcePath } from '@/components/ai/AiSourceList';
import type { AiSemanticResult } from '@/utils/aiApi';
import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AiAnswerExportCardProps {
  content: string;
  sources?: AiSemanticResult[];
  sourceTitle: string;
  author?: {
    nickname?: string;
    avatar?: string;
    username?: string;
  };
  onReady?: () => void;
}

export default function AiAnswerExportCard({
  content,
  sources,
  sourceTitle,
  author,
  onReady,
}: AiAnswerExportCardProps) {
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => onReady?.());
    });
  }, [onReady]);

  return (
    <div
      style={{
        width: 720,
        background: '#ffffff',
        padding: '40px 48px',
        fontFamily: '"Noto Serif SC", "Optima-Regular", "PingFangSC-light", "Heiti SC", sans-serif',
        color: '#1a1a1a',
        overflow: 'visible',
      }}
    >
      <div className="prose" style={{ maxWidth: 'none', color: '#333', overflow: 'visible' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>

      {sources && sources.length > 0 && (
        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: '1px solid #e5e5e5',
            color: '#666',
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 700, color: '#444' }}>{sourceTitle}</div>
          {sources.slice(0, 8).map((source, index) => {
            const text =
              source.metadata?.title ||
              source.preview ||
              cleanSourceText(source.text || '').slice(0, 120);
            return (
              <div key={`${source.sourceType}-${source.sourceId}`} style={{ marginTop: 6 }}>
                <span style={{ color: '#999' }}>[{index + 1}] </span>
                <span>{text}</span>
                <div style={{ color: '#aaa', fontSize: 11 }}>
                  {window.location.origin}
                  {getAiSourcePath(source)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .prose img {
          border-radius: 0 !important;
          box-shadow: none !important;
          max-width: 100% !important;
          height: auto !important;
        }
        .prose pre {
          border-radius: 0 !important;
          overflow-x: visible !important;
        }
      `}</style>

      <hr
        style={{ border: 'none', borderTop: '1px solid #e5e5e5', marginTop: 32, marginBottom: 16 }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 13,
          color: '#888',
        }}
      >
        {author ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={author.avatar || '/DefaultAvatar.svg'}
              alt=""
              crossOrigin="anonymous"
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                objectFit: 'cover',
                border: '1px solid #e5e5e5',
              }}
            />
            <span style={{ color: '#555' }}>
              {`${window.location.origin}${author.username ? `/${author.username}` : ''}`}
            </span>
          </div>
        ) : (
          <div />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src="/ico.svg" alt="Rote" style={{ width: 16, height: 16 }} />
          <span style={{ fontWeight: 600, color: '#3ECF4A' }}>Rote</span>
        </div>
      </div>
    </div>
  );
}
