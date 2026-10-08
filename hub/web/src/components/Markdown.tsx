import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Render markdown của Lucy theo style sci-fi nhưng DỄ ĐỌC (xem .md trong index.css).
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md text-[13px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
