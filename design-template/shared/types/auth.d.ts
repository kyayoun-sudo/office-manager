// Interface de base pour l'utilisateur
export interface User {
  id: number
  email: string
  firstName: string
  lastName: string
  phone: string | null
  address: string | null
  houseNumber: string | null
  postalCode: string | null
  profilePhoto: string | null
  isActive: boolean
  confirmedAt: Date | null
  latitude: number | null
  longitude: number | null
  preferredLanguages: string[]
  lastLoginAt: Date | null
  
  // Relations
  city: {
    id: number
    name: string
    postalCode: string | null
    countryId: number | null
  } | null
  
  role: {
    id: number
    code: string
    name: string
    description: string | null
  } | null
  
  patient: {
    id: number
    birthDate: Date | null
  } | null
  
  clinician: {
    id: number
    inamiNumber: string | null
    verified: boolean | null
    bio: string | null
    experienceYears: number | null
    acceptingNewPatients: boolean
    hasActiveSubscription: boolean
    specialties: SpecialtyDto[]
    offices: OfficeDto[]
  } | null
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}

// Interface pour les spécialités
export interface SpecialtyDto {
  id: number
  code: string
  name: string
  translations: TranslationDto[]
  category: {
    id: number
    code: string
    name: string
    translations: TranslationDto[]
  } | null
}

// Interface pour les offices
export interface OfficeDto {
  id: number
  name: string
  address: string | null
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  additionalInfo: string | null
  mapLink: string | null
  color: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  email: string | null
  description: string | null
  isActive: boolean
  defaultDuration: number | null
  createdAt: Date
  updatedAt: Date
}

// Interface pour les traductions
export interface TranslationDto {
  language: string | undefined
  name: string
}

// Interface simplifiée pour les besoins basiques
export interface UserBasic {
  id: number
  email: string
  firstName: string
  lastName: string
  userType: string
  role: string
  profilePhoto: string | null
}

// DTOs pour les requêtes d'authentification
export interface LoginDto {
  email: string
  password: string
}

export interface RefreshTokenDto {
  refreshToken: string
}

export interface ForgotPasswordDto {
  email: string
}

export interface ResetPasswordDto {
  email: string
  code: string
  newPassword: string
}

// Réponses d'authentification selon le contrôleur
export interface LoginDirectResponse {
  success: boolean
  message?: string
  token: string
  refreshToken: string
  data: {
    userId: number
    email: string
    userType: string
    profile: {
      id: number
      firstName: string
      lastName: string
      profilePhotoUrl: string | null
    }
  }
}

export interface AdminOtpResponse {
  success: boolean
  requiresOtp: true
  otpToken: string
}

export type LoginResponse = LoginDirectResponse | AdminOtpResponse

export interface VerifyOtpDto {
  otpToken: string
  code: string
}

export interface RefreshTokenResponse {
  success: boolean
  message?: string
  token: string
  refreshToken: string
  data: {
    user: {
      id: number
      email: string
      firstName: string
      lastName: string
      role: string
    }
  }
}

// Interface JWT Payload
export interface JwtPayload {
  sub: number
  email: string
  type: 'access' | 'refresh'
  role: string
  iat: number
  exp: number
}

// Interface pour getCurrentUser (endpoint complet)
export interface GetCurrentUserResponse extends User {}

// Interfaces pour l'état d'authentification
export interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

// Types pour la gestion des rôles et permissions
export type UserRole = 'admin' | 'support' | 'patient' | 'clinician'

export interface RolePermissions {
  [role: string]: string[]
}

// Interface pour les erreurs d'authentification
export interface AuthError {
  success: false
  message: string
  statusCode?: number
}

// Types utilitaires
export type LoginCredentials = LoginDto
export type AuthResponse = LoginResponse

// Interface pour les hooks d'components
export interface UseAuthReturn {
  user: Readonly<Ref<User | null>>
  token: Readonly<Ref<string | null>>
  refreshToken: Readonly<Ref<string | null>>
  isLoading: Readonly<Ref<boolean>>
  isAuthenticated: ComputedRef<boolean>
  login: (credentials: LoginCredentials) => Promise<LoginResponse | AuthError>
  verifyOtp: (dto: VerifyOtpDto) => Promise<LoginDirectResponse | AuthError>
  logout: () => Promise<void>
  refreshAuthToken: () => Promise<RefreshTokenResponse>
  refreshUser: () => Promise<void>
  hasRole: (role: UserRole) => boolean
  hasPermission: (permission: string) => boolean
  autoRefreshToken: () => Promise<boolean>
  initAuth: () => Promise<void>
  isAdmin: ComputedRef<boolean>
  isSupport: ComputedRef<boolean>
  isPatient: ComputedRef<boolean>
  isClinician: ComputedRef<boolean>
  // Token/User utilities
  getToken: () => string | null
  setToken: (token: string | null) => void
  getRefreshToken: () => string | null
  setRefreshToken: (token: string | null) => void
  getUser: () => User | null
  setUser: (user: User | null) => void
}