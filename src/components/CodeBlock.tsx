import { useMemo } from 'react'
import clsx from 'clsx'
import { highlight, langFor } from '../lib/highlight'

/** Syntax-highlighted code with optional line numbers. */
export default function CodeBlock({
  content,
  language,
  path,
  lineNumbers = true,
  className,
}: {
  content: string
  language?: string
  path?: string
  lineNumbers?: boolean
  className?: string
}) {
  const lang = langFor(language, path)
  const lines = useMemo(() => content.replace(/\n$/, '').split('\n'), [content])
  const html = useMemo(() => lines.map((l) => highlight(l, language, path)), [lines, language, path])

  return (
    <div className={clsx('overflow-auto rounded-lg border border-line bg-code', className)}>
      <table className="w-full border-collapse font-mono text-[12.5px] leading-relaxed">
        <tbody>
          {html.map((h, i) => (
            <tr key={i} className="hover:bg-white/[0.03]">
              {lineNumbers && (
                <td className="select-none border-r border-line/60 px-2.5 text-right align-top text-zinc-600">
                  {i + 1}
                </td>
              )}
              <td className="hljs whitespace-pre px-3 align-top text-zinc-200" dangerouslySetInnerHTML={{ __html: h || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
      {lang && (
        <div className="border-t border-line/60 px-3 py-1 text-right text-[10px] uppercase tracking-wide text-zinc-600">
          {lang}
        </div>
      )}
    </div>
  )
}
