export interface ReadinessSnapshot {
  ready: boolean
  reason?: string
}

export class RuntimeState {
  #snapshot: ReadinessSnapshot

  constructor(ready = true, reason?: string) {
    this.#snapshot = {
      ready,
      ...(reason ? { reason } : {})
    }
  }

  markReady() {
    this.#snapshot = { ready: true }
  }

  markNotReady(reason: string) {
    this.#snapshot = { ready: false, reason }
  }

  getReadiness(): ReadinessSnapshot {
    return { ...this.#snapshot }
  }
}
