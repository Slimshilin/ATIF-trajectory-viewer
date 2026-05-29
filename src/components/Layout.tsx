import clsx from 'clsx'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Rocket, FolderTree, Upload as UploadIcon, Sparkles,
  PanelLeftClose, PanelLeftOpen, Compass, BarChart3, type LucideIcon,
} from 'lucide-react'
import { useDataset } from '../lib/dataset'
import { startTour, buildTourSteps } from '../lib/tour'

const nav: { to: string; label: string; Icon: LucideIcon; end?: boolean }[] = [
  { to: '/quickstart', label: 'Quick start', Icon: Rocket },
  { to: '/showcase', label: 'Feature showcase', Icon: Sparkles },
  { to: '/overview', label: 'Overview', Icon: LayoutDashboard },
  { to: '/insights', label: 'AFT insights', Icon: BarChart3 },
  { to: '/tasks', label: 'Tasks', Icon: FolderTree },
  { to: '/upload', label: 'Upload', Icon: UploadIcon },
]

const NAV_KEY = 'tv-nav-collapsed'

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-ink-950">
        <span className="font-mono text-sm font-bold">A</span>
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">ATIF</div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Trajectory Viewer</div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const loc = useLocation()
  const navigate = useNavigate()
  const data = useDataset()
  // Open-source build: no auth, no sign-in state to show.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(NAV_KEY) === '1')
  const toggle = () => setCollapsed((c) => { localStorage.setItem(NAV_KEY, c ? '0' : '1'); return !c })
  const launchTour = () => { if (data) startTour(buildTourSteps(), navigate) }

  return (
    <div className="flex h-full">
      <aside className={clsx('flex shrink-0 flex-col border-r border-line bg-ink-900/60 py-4 transition-[width] duration-150', collapsed ? 'w-16 px-2 items-center' : 'w-60 px-4')}>
        <div className={clsx('flex w-full items-center', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <BrandMark collapsed={false} />}
          <button
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-ink-800 hover:text-zinc-200"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="mt-6 flex w-full flex-col gap-1">
          {nav.map((n) => {
            const active = n.end ? loc.pathname === '/' : loc.pathname.startsWith(n.to)
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                title={n.label}
                className={clsx(
                  'flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'px-3 py-2',
                  active ? 'bg-ink-800 text-white' : 'text-zinc-400 hover:bg-ink-800/60 hover:text-zinc-100',
                )}
              >
                <n.Icon size={17} className="shrink-0" />
                {!collapsed && <span>{n.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        <button
          onClick={launchTour}
          disabled={!data}
          title="Start the guided tour"
          className={clsx(
            'mt-2 flex w-full items-center gap-2.5 rounded-lg text-sm font-medium text-accent ring-1 ring-accent/30 transition-colors hover:bg-accent/10 disabled:opacity-40',
            collapsed ? 'justify-center px-0 py-2' : 'px-3 py-2',
          )}
        >
          <Compass size={17} className="shrink-0" />
          {!collapsed && <span>Guided tour</span>}
        </button>

        {!collapsed && (
          <div className="mt-auto w-full text-[11px] text-zinc-600">
            ATIF Trajectory Viewer · Apache-2.0
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-8 py-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
