export function downloadMarkdown(content: string, title?: string): void {
  if (!content) return;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title ? `${title}.md` : 'article.md';
  a.click();
  URL.revokeObjectURL(url);
}
