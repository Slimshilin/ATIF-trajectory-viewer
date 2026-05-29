import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import QuickStart from './pages/QuickStart'
import Showcase from './pages/Showcase'
import AftInsights from './pages/AftInsights'
import Tasks from './pages/Tasks'
import Upload from './pages/Upload'
import TaskDetail from './pages/TaskDetail'
import TrajectoryViewer from './pages/TrajectoryViewer'
import { trackPageview } from './lib/analytics'

// Router-aware page-view tracker — fires for the initial render AND every
// client-side route change so GA4 sees the full SPA navigation flow.
function RouteTracker() {
  const loc = useLocation()
  useEffect(() => {
    trackPageview(loc.pathname + loc.search)
  }, [loc.pathname, loc.search])
  return null
}

export default function App() {
  return (
    <>
      <RouteTracker />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/quickstart" replace />} />
          <Route path="quickstart" element={<QuickStart />} />
          <Route path="overview" element={<Overview />} />
          <Route path="insights" element={<AftInsights />} />
          <Route path="showcase" element={<Showcase />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="upload" element={<Upload />} />
          <Route path="tasks/:taskId" element={<TaskDetail />} />
          <Route path="tasks/:taskId/runs/:runId" element={<TrajectoryViewer />} />
          <Route path="*" element={<div className="p-8 text-zinc-400">Not found.</div>} />
        </Route>
      </Routes>
    </>
  )
}
