export type DockerState = 'running' | 'paused' | 'restarting' | 'created' | 'exited' | 'dead' | 'removing'
export type DockerHealth = 'healthy' | 'unhealthy' | 'starting' | null

export interface DockerPort {
  /** Port published on the host (null: exposed inside the container only). */
  host: number | null
  container: number
  protocol: string
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  state: DockerState
  health: DockerHealth
  /** Docker's own wording, e.g. `Up 6 days (healthy)` or `Exited (0) 2 hours ago`. */
  status: string
  ports: DockerPort[]
  /** Docker Compose project and service, when the container comes from a compose file. */
  composeProject: string | null
  composeService: string | null
  /** Folder the compose project was started from: ties the container to a Capitaine project. */
  composeDir: string | null
  createdAt: string
}

export type DockerListResult =
  | { ok: true; containers: DockerContainer[] }
  /** `missing`: no docker CLI found; `daemon`: CLI found but the engine didn't answer. */
  | { ok: false; reason: 'missing' | 'daemon'; message: string }

export type DockerAction = 'start' | 'stop' | 'restart'
