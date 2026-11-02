import type { CapitaineApi } from '../shared/types'

declare global {
  interface Window {
    capitaine: CapitaineApi
  }
}

export {}
