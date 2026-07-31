// v11-fix: Return a blank background instead of a skeleton layout.
// The skeleton was causing a visible flash on app startup — when the
// SPLASH_BOOTSTRAP overlay fades out (350ms), the skeleton was visible
// behind it, creating a "flash of old loading screen" effect.
// Now we return a minimal div with just the theme background color,
// which blends seamlessly with the splash overlay and the actual page
// content. No skeleton, no spinner, no visual flash.
export default function Loading() {
  return (
    <div
      className="min-h-screen bg-background"
      style={{ minHeight: '100dvh' }}
      aria-hidden="true"
    />
  )
}
