import type { ReactNode } from "react"
import { useBackground } from "@/lib/background"

import { Sidebar } from "@/components/Sidebar"
import { TopBar } from "@/components/TopBar"

export function AppShell({ children }: { children: ReactNode }) {
  const background = useBackground()
  return (
    <div className="app-shell relative isolate flex h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="app-wallpaper" style={background ? { backgroundImage: `linear-gradient(rgb(8 12 20 / 0.40), rgb(8 12 20 / 0.40)), url(\"${background}\")` } : undefined} />
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
