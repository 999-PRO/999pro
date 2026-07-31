declare module 'web-push' {
  interface PushSubscriptionOptions {
    vapidDetails?: {
      publicKey: string
      privateKey: string
      subject?: string
    }
    TTL?: number
    urgency?: 'very-low' | 'low' | 'normal' | 'high'
    topic?: string
  }
  interface SendResult {
    statusCode: number
    body: string
    headers: Record<string, string>
  }
  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void
  export function sendNotification(
    subscription: {
      endpoint: string
      keys?: { p256dh?: string; auth?: string }
      expirationTime?: number | null
    },
    payload?: string | Buffer | null,
    options?: PushSubscriptionOptions,
  ): Promise<SendResult>
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
  const _default: {
    setVapidDetails: typeof setVapidDetails
    sendNotification: typeof sendNotification
    generateVAPIDKeys: typeof generateVAPIDKeys
  }
  export default _default
}
