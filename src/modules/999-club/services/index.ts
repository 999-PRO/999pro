/**
 * 999 CLUB — services layer.
 *
 * Services orchestrate multiple API calls. Components call services,
 * services call the API client. This keeps components thin.
 */

import { clubApi } from '../api'

export const clubService = {
  /** Load everything needed for the landing page in a single call. */
  async loadLanding() {
    return clubApi.getLanding()
  },
  /** Refresh a single entity list (used after a claim/participate action). */
  async refreshLanding() {
    return clubApi.getLanding()
  },
}
