export default defineNuxtPlugin(async () => {
  const { initAuth, logout, autoRefreshToken, isAuthenticated, setToken, setRefreshToken, setUser } = useAuth()
  const router = useRouter()

  const { setGlobalLogout } = await import('~/utils/api')
  setGlobalLogout(logout)

  await initAuth()

  const REFRESH_CHECK_INTERVAL = 2 * 60 * 1000
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  const startRefreshTimer = () => {
    if (refreshTimer) return
    refreshTimer = setInterval(() => {
      if (isAuthenticated.value) {
        autoRefreshToken()
      }
    }, REFRESH_CHECK_INTERVAL)
  }

  const stopRefreshTimer = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  watch(isAuthenticated, (authenticated) => {
    if (authenticated) startRefreshTimer()
    else stopRefreshTimer()
  }, { immediate: true })

  window.addEventListener('storage', (event) => {
    if (event.key === 'app_token' && event.newValue === null) {
      setToken(null)
      setRefreshToken(null)
      setUser(null)
      router.push('/login')
    }
  })
})