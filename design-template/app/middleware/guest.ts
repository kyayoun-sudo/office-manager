export default defineNuxtRouteMiddleware(() => {
  const { isAuthenticated, initAuth } = useAuth()
  
  // Initialize components state
  initAuth()
  
  // If authenticated, redirect to components
  if (isAuthenticated.value) {
    return navigateTo('/')
  }
})