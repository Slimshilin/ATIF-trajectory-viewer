import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import ruby from 'highlight.js/lib/languages/ruby'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import ini from 'highlight.js/lib/languages/ini'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import diff from 'highlight.js/lib/languages/diff'
import markdown from 'highlight.js/lib/languages/markdown'

const langs: Record<string, unknown> = {
  javascript, js: javascript, jsx: javascript,
  typescript, ts: typescript, tsx: typescript,
  python, py: python, bash, sh: bash, shell: bash, zsh: bash,
  json, c, h: c, cpp, 'c++': cpp, go, rust, rs: rust, ruby, rb: ruby,
  sql, yaml, yml: yaml, xml, html: xml, vue: xml, ini, toml: ini, cfg: ini,
  dockerfile, diff, patch: diff, markdown, md: markdown,
}
const registered = new Set<string>()
for (const [name, def] of Object.entries(langs)) {
  if (!registered.has(name)) {
    try {
      hljs.registerLanguage(name, def as never)
      registered.add(name)
    } catch {
      /* alias already registered */
    }
  }
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', bash: 'bash',
  json: 'json', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', go: 'go',
  rs: 'rust', rb: 'ruby', sql: 'sql', yml: 'yaml', yaml: 'yaml', html: 'xml',
  htm: 'xml', xml: 'xml', vue: 'xml', toml: 'ini', ini: 'ini', cfg: 'ini',
  md: 'markdown', markdown: 'markdown', diff: 'diff', patch: 'diff',
}

export function langFor(language?: string, path?: string): string | undefined {
  if (language && hljs.getLanguage(language)) return language
  if (language && EXT_LANG[language]) return EXT_LANG[language]
  const base = (path ?? '').toLowerCase().split('/').pop() ?? ''
  if (/dockerfile$/.test(base)) return 'dockerfile'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_LANG[ext]
}

/** Returns highlighted HTML (already escaped by hljs). Falls back to escaped plain text. */
export function highlight(code: string, language?: string, path?: string): string {
  const lang = langFor(language, path)
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
  } catch {
    /* fall through */
  }
  return escapeHtml(code)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
