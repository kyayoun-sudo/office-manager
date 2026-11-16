import type {
  LoginCredentials,
  LoginResponse,
  LoginDirectResponse,
  AdminOtpResponse,
  VerifyOtpDto,
  RefreshTokenResponse,
  RefreshTokenDto,
  User,
  UserRole,
  AuthError,
  UseAuthReturn,
  GetCurrentUserResponse,
} from '~~/shared/types/auth'
import { useApiResponse } from './useApiResponse'
import { proxyFetch } from '~/utils/proxyFetch'

let refreshPromise: Promise<boolean> | null = null

export const useAuth = (): UseAuthReturn => {
  const router = useRouter()
  const { handleApiResponse } = useApiResponse()

  // Reactive state
  const user = useState<User | null>('components.user', () => null)
  const token = useState<string | null>('components.token', () => null)
  const refreshToken = useState<string | null>(
    'components.refreshToken',
    () => null,
  )
  const isLoading = useState<boolean>('components.loading', () => false)

  // Computed properties
  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const isAdmin = computed(() => user.value?.role?.code === 'admin')
  const isSupport = computed(() => user.value?.role?.code === 'support')
  const isPatient = computed(() => user.value?.role?.code === 'patient')
  const isClinician = computed(() => user.value?.role?.code === 'clinician')

  // Token management
  const setToken = (newToken: string | null) => {
    token.value = newToken
    if (import.meta.client) {
      if (newToken) {
        localStorage.setItem('app_token', newToken)
      } else {
        localStorage.removeItem('app_token')
      }
    }
  }

  const setRefreshToken = (newRefreshToken: string | null) => {
    refreshToken.value = newRefreshToken
    if (import.meta.client) {
      if (newRefreshToken) {
        localStorage.setItem('app_refresh_token', newRefreshToken)
      } else {
        localStorage.removeItem('app_refresh_token')
      }
    }
  }

  const getToken = (): string | null => {
    if (import.meta.client && !token.value) {
      token.value = localStorage.getItem('app_token')
    }
    return token.value
  }

  const getRefreshToken = (): string | null => {
    if (import.meta.client && !refreshToken.value) {
      refreshToken.value = localStorage.getItem('app_refresh_token')
    }
    return refreshToken.value
  }

  // User management
  const setUser = (newUser: User | null) => {
    user.value = newUser
    if (import.meta.client) {
      if (newUser) {
        localStorage.setItem('app_user', JSON.stringify(newUser))
      } else {
        localStorage.removeItem('app_user')
      }
    }
  }

  const getUser = (): User | null => {
    if (import.meta.client && !user.value) {
      const storedUser = localStorage.getItem('app_user')
      if (storedUser) {
        try {
          user.value = JSON.parse(storedUser)
        } catch (error) {
          console.error("Erreur lors du parsing de l'utilisateur:", error)
          localStorage.removeItem('app_user')
        }
      }
    }
    return user.value
  }

  const ALLOWED_ROLES = new Set<string>(['admin', 'support'])

  const handleLoginSuccess = (response: LoginDirectResponse) => {
    const { data } = response

    if (!ALLOWED_ROLES.has(data.userType)) {
      throw { rejected: true, message: 'Acces reserve aux administrateurs' }
    }

    setToken(response.token)
    setRefreshToken(response.refreshToken)
    const userData: User = {
      id: data.userId,
      email: data.email,
      firstName: data.profile.firstName,
      lastName: data.profile.lastName,
      phone: null,
      address: null,
      houseNumber: null,
      postalCode: null,
      profilePhoto: data.profile.profilePhotoUrl,
      isActive: true,
      confirmedAt: new Date(),
      latitude: null,
      longitude: null,
      preferredLanguages: ['fr'],
      lastLoginAt: new Date(),
      city: null,
      role: {
        id: 0,
        code: data.userType,
        name: data.userType,
        description: null,
      },
      patient: null,
      clinician: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setUser(userData)
  }

  // Login function
  const login = async (
    credentials: LoginCredentials,
  ): Promise<LoginResponse | AuthError> => {
    isLoading.value = true

    try {
      const response = await proxyFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: credentials,
      })

      if (!response.success) {
        return {
          success: false,
          message: (response as any).message || 'Erreur de connexion',
        }
      }

      if ('requiresOtp' in response && response.requiresOtp) {
        return response as AdminOtpResponse
      }

      const directResponse = response as LoginDirectResponse
      handleLoginSuccess(directResponse)
      return directResponse
    } catch (error: any) {
      if (error.rejected) {
        return { success: false, message: error.message }
      }
      if (error.data) {
        return {
          success: false,
          message: error.data.message || 'Identifiants incorrects',
          statusCode: error.status,
        }
      }

      return {
        success: false,
        message: 'Erreur de connexion au serveur',
      }
    } finally {
      isLoading.value = false
    }
  }

  // Verify OTP function
  const verifyOtp = async (
    dto: VerifyOtpDto,
  ): Promise<LoginDirectResponse | AuthError> => {
    isLoading.value = true

    try {
      const response = await proxyFetch<LoginDirectResponse>(
        '/auth/verify-otp',
        {
          method: 'POST',
          body: dto,
        },
      )

      if (!response.success) {
        return {
          success: false,
          message: (response as any).message || 'Code OTP invalide',
        }
      }

      handleLoginSuccess(response)
      return response
    } catch (error: any) {
      if (error.rejected) {
        return { success: false, message: error.message }
      }
      if (error.data) {
        return {
          success: false,
          message: error.data.message || 'Code OTP invalide ou session expirée',
          statusCode: error.status,
        }
      }

      return {
        success: false,
        message: 'Erreur de connexion au serveur',
      }
    } finally {
      isLoading.value = false
    }
  }

  // Refresh token function
  const refreshAuthToken = async (): Promise<RefreshTokenResponse> => {
    const currentToken = getToken()
    const currentRefreshToken = getRefreshToken()

    if (!currentToken || !currentRefreshToken) {
      throw new Error('No tokens available')
    }

    const response = await proxyFetch<RefreshTokenResponse>('/auth/refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentToken}`,
      },
      body: {
        refreshToken: currentRefreshToken,
      },
    })

    if (!response.success) {
      throw new Error(response.message || 'Token refresh failed')
    }

    setToken(response.token)
    setRefreshToken(response.refreshToken)

    if (user.value) {
      const updatedUser: User = {
        ...user.value,
        id: response.data.user.id,
        email: response.data.user.email,
        firstName: response.data.user.firstName,
        lastName: response.data.user.lastName,
        role: {
          ...user.value.role!,
          code: response.data.user.role,
          name: response.data.user.role,
        },
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      }
      setUser(updatedUser)
    }

    return response
  }

  const logout = async () => {
    setToken(null)
    setRefreshToken(null)
    setUser(null)

    if (import.meta.client) {
      await router.push('/login')
    }
  }

  // Refresh user data - Utilise l'endpoint getCurrentUser du service Auth
  const refreshUser = async (): Promise<void> => {
    const currentToken = getToken()
    if (!currentToken) {
      console.warn('Aucun token disponible pour refreshUser')
      return
    }

    try {
      // L'endpoint correct est /me selon le MeController
      // Utiliser l'API utility qui gère automatiquement les headers
      const response = await api.get<GetCurrentUserResponse>('/me')

      const {
        success,
        data,
        error: apiError,
      } = handleApiResponse<User>(response)

      if (success && data) {
        setUser(data)
        console.log('Données utilisateur mises à jour:', data)
      } else {
        console.warn(
          'Réponse invalide du serveur pour /me:',
          apiError || 'Erreur inconnue',
        )
      }
    } catch (error: any) {
      console.error("Erreur lors du rafraîchissement de l'utilisateur:", error)

      // Si erreur 401, le token est invalide
      if (error.status === 401 || error.statusCode === 401) {
        console.warn('Token invalide, déconnexion...')
        await logout()
      } else {
        // Pour les autres erreurs, on ne déconnecte pas automatiquement
        console.warn('Erreur temporaire lors de la récupération du profil')
      }
    }
  }

  // Role and permission helpers
  const hasRole = (role: UserRole): boolean => {
    return user.value?.role?.code === role
  }

  const hasPermission = (permission: string): boolean => {
    if (!user.value?.role?.code) return false

    const userRole = user.value.role.code

    // Admin a tous les droits
    if (userRole === 'admin') return true

    // Support a des droits étendus
    if (userRole === 'support') {
      switch (permission) {
        case 'components.view':
        case 'offices.view':
        case 'notifications.send':
          return true
        default:
          return false
      }
    }

    // Clinician a des droits limités
    if (userRole === 'clinician') {
      switch (permission) {
        case 'components.view':
        case 'offices.manage': // Leurs propres offices
        case 'appointments.manage':
          return true
        default:
          return false
      }
    }

    // Patient a des droits très limités
    if (userRole === 'patient') {
      switch (permission) {
        case 'profile.view':
        case 'appointments.view':
          return true
        default:
          return false
      }
    }

    return false
  }

  // Check if token is expired
  const isTokenExpired = (): boolean => {
    const currentToken = getToken()
    if (!currentToken) return true

    try {
      const payload = JSON.parse(atob(currentToken.split('.')[1]))
      const currentTime = Math.floor(Date.now() / 1000)
      // Considérer le token comme expiré 5 minutes avant l'expiration réelle
      return payload.exp < currentTime + 300
    } catch (error) {
      return true
    }
  }

  // Auto-refresh token if needed (with lock to prevent concurrent refreshes)
  const autoRefreshToken = async (): Promise<boolean> => {
    if (!getToken() || !getRefreshToken()) {
      return false
    }

    if (!isTokenExpired()) return true

    // If a refresh is already in progress, wait for it instead of starting a new one
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
      try {
        await refreshAuthToken()
        return true
      } catch (error) {
        console.error('Erreur lors du refresh automatique:', error)
        await logout()
        return false
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  }

  // Initialize components state from localStorage
  const initAuth = async () => {
    if (import.meta.client) {
      getToken()
      getRefreshToken()
      getUser()

      // Tenter un refresh automatique si on a les tokens et que le token est expiré
      if (token.value && refreshToken.value && isTokenExpired()) {
        await autoRefreshToken()
      } else if (token.value && !refreshToken.value && isTokenExpired()) {
        // Si on a seulement le token d'accès et qu'il est expiré, déconnecter
        await logout()
      }

      // Si on a un token valide mais pas de données utilisateur, les récupérer
      if (token.value && !user.value) {
        await refreshUser()
      }
    }
  }

  return {
    // State
    user: readonly(user) as Readonly<Ref<User | null>>,
    token: readonly(token),
    refreshToken: readonly(refreshToken),
    isLoading: readonly(isLoading),
    isAuthenticated,

    // Role computed properties
    isAdmin,
    isSupport,
    isPatient,
    isClinician,

    // Methods
    login,
    verifyOtp,
    logout,
    refreshAuthToken,
    refreshUser,
    hasRole,
    hasPermission,
    autoRefreshToken,
    initAuth,

    // Token/User utilities
    getToken,
    setToken,
    getRefreshToken,
    setRefreshToken,
    getUser,
    setUser,
  }
}
