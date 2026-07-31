/**
 * 999 CLUB — hooks.
 *
 * `useClubLanding` — loads the single landing payload (all 8 lists + points
 * + referral) on mount. Exposes `refresh()` to re-fetch after a claim/
 * participate action so the UI stays in sync.
 */

import { useEffect, useState, useCallback } from 'react'
import { clubService } from '../services'
import type { ClubLanding } from '../types'

export function useClubLanding() {
  const [data, setData] = useState<ClubLanding | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await clubService.loadLanding()
      setData(result)
      setError(null)
    } catch (e: any) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(async () => {
    try {
      const result = await clubService.refreshLanding()
      setData(result)
    } catch {
      // silent — the initial load already set the error state
    }
  }, [])

  return { data, loading, error, refresh }
}
