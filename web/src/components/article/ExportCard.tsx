import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ExportCardProps {
  title: string;
  content: string;
  author?: {
    nickname?: string;
    avatar?: string;
    username?: string;
  };
  onReady?: () => void;
}

export default function ExportCard({ title, content, author, onReady }: ExportCardProps) {
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
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 24,
          lineHeight: 1.3,
          color: '#000',
        }}
      >
        {title}
      </h1>
      <hr style={{ border: 'none', borderTop: '1px solid #e5e5e5', marginBottom: 24 }} />
      <div className="prose prose-sm" style={{ maxWidth: 'none', color: '#333' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
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
        {author && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={author.avatar || '/DefaultAvatar.svg'}
              alt=""
              style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }}
            />
            <span style={{ color: '#555' }}>
              {window.location.origin}/{author.username}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src="/ico.svg" alt="Rote" style={{ width: 16, height: 16 }} />
          <span style={{ fontWeight: 600, color: '#07C160' }}>Rote</span>
        </div>
      </div>
    </div>
  );
}
