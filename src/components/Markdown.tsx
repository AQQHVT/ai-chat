import { memo, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown ответа модели. Сырой HTML не рендерится (react-markdown по умолчанию
 * его экранирует, rehype-raw мы не подключаем) — текст модели нельзя считать
 * доверенным, это прямой путь к XSS.
 */
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Широкие таблицы и код скроллятся внутри себя, а не растягивают страницу на телефоне.
  table: ({ node: _node, ...props }) => (
    <div className="md-scroll" tabIndex={0} role="region" aria-label="Таблица">
      <table {...props} />
    </div>
  ),
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
};

function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const code = e.currentTarget.parentElement?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен (http, запрет) — ничего страшного */
    }
  };
  return (
    <div className="code-block">
      <button type="button" className="code-copy" onClick={copy}>
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
      <pre {...props} tabIndex={0} />
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});
