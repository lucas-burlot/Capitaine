type DataHandler = (data: string) => void
type ExitHandler = (exitCode: number) => void

interface Route {
  onData: DataHandler
  onExit: ExitHandler
  onProcess?: (processName: string) => void
}

const routes = new Map<string, Route>()
// Events that arrive before the terminal registered its route (spawn/IPC race).
const pendingData = new Map<string, string[]>()
const pendingExit = new Map<string, number>()

window.capitaine.pty.onData((id, data) => {
  const route = routes.get(id)
  if (route) route.onData(data)
  else pendingData.set(id, [...(pendingData.get(id) ?? []), data])
})

window.capitaine.pty.onExit((id, exitCode) => {
  const route = routes.get(id)
  if (route) {
    routes.delete(id)
    route.onExit(exitCode)
  } else {
    pendingExit.set(id, exitCode)
  }
})

window.capitaine.pty.onProcess((id, name) => routes.get(id)?.onProcess?.(name))

/** Single IPC listener fanned out to each terminal by pty id. */
export function attachPty(id: string, route: Route): () => void {
  for (const chunk of pendingData.get(id) ?? []) route.onData(chunk)
  pendingData.delete(id)
  const exitCode = pendingExit.get(id)
  if (exitCode !== undefined) {
    pendingExit.delete(id)
    route.onExit(exitCode)
    return () => {}
  }
  routes.set(id, route)
  return () => routes.delete(id)
}
