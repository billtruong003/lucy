import { defineConfig } from 'vitepress'

const guide = (prefix: string, t: Record<string, string>) => [
  { text: t.start, items: [
    { text: t.introduction, link: `${prefix}/guide/introduction` },
    { text: t.installation, link: `${prefix}/guide/installation` },
    { text: t.configuration, link: `${prefix}/guide/configuration` },
  ] },
  { text: t.using, items: [
    { text: t.telegram, link: `${prefix}/guide/telegram` },
    { text: t.webHub, link: `${prefix}/guide/web-hub` },
    { text: t.automations, link: `${prefix}/guide/automations` },
  ] },
  { text: t.concepts, items: [
    { text: t.memory, link: `${prefix}/guide/memory` },
    { text: t.agents, link: `${prefix}/guide/agents` },
    { text: t.models, link: `${prefix}/guide/models` },
    { text: t.skills, link: `${prefix}/guide/skills-mcp` },
  ] },
  { text: t.run, items: [
    { text: t.security, link: `${prefix}/guide/security` },
    { text: t.operations, link: `${prefix}/guide/operations` },
  ] },
]

const en = {
  start: 'Getting started', introduction: 'Introduction', installation: 'Installation', configuration: 'Configuration',
  using: 'Using Lucy', telegram: 'Telegram', webHub: 'Web hub', automations: 'Automations',
  concepts: 'Concepts', memory: 'Memory', agents: 'Agents & board', models: 'Models', skills: 'Skills & MCP',
  run: 'Running Lucy', security: 'Security', operations: 'Operations & troubleshooting',
}
const vi = {
  start: 'Bắt đầu', introduction: 'Giới thiệu', installation: 'Cài đặt', configuration: 'Cấu hình',
  using: 'Sử dụng', telegram: 'Telegram', webHub: 'Web hub', automations: 'Tự động hoá',
  concepts: 'Khái niệm', memory: 'Bộ nhớ', agents: 'Agent & bảng việc', models: 'Model', skills: 'Skill & MCP',
  run: 'Vận hành', security: 'Bảo mật', operations: 'Vận hành & xử lý sự cố',
}

export default defineConfig({
  title: 'Lucy',
  description: 'Self-hosted personal AI agent on Claude',
  base: process.env.DOCS_BASE || '/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/billtruong003/lucy' }],
  },
  locales: {
    root: {
      label: 'English', lang: 'en',
      themeConfig: {
        nav: [{ text: 'Guide', link: '/guide/introduction' }],
        sidebar: guide('', en),
      },
    },
    vi: {
      label: 'Tiếng Việt', lang: 'vi', link: '/vi/',
      themeConfig: {
        nav: [{ text: 'Hướng dẫn', link: '/vi/guide/introduction' }],
        sidebar: guide('/vi', vi),
        outline: { label: 'Trên trang này' },
        docFooter: { prev: 'Trang trước', next: 'Trang sau' },
      },
    },
  },
})
