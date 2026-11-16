export default defineNuxtRouteMiddleware(async () => {
  const { isAuthenticated, isAdmin, isSupport, initAuth } = useAuth()
  
  // Initialize components state
  await initAuth()
  
  // If not authenticated, redirect to login
  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }

  // Check if user has admin or support role
  if (!isAdmin.value && !isSupport.value) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Accès refusé - Rôle administrateur ou support requis'
    })
  }
})