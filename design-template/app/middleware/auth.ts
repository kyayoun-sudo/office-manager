export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated, initAuth } = useAuth()
  
  // Initialize components state from localStorage and check token validity
  await initAuth()
  
  // If not authenticated after initialization, redirect to login
  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }
})