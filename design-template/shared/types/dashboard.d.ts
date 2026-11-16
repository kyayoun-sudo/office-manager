export interface DashboardStats {
  totalUsers: number
  totalPatients: number
  totalClinicians: number
  appointmentsThisMonth: number
  appointmentsToday: number
  upcomingAppointments: number
  revenueThisMonth: number
  activeSubscriptions: number
  availableTimeSlots: number
  openSupportTickets: number
  // Optionnelles - non présentes dans l'API actuelle
  pendingUserReports?: number
  unsentAdminMessages?: number
}

export interface RecentUser {
  id: number
  firstName: string
  lastName: string
  email: string
  createdAt: string
  userType: 'admin' | 'provider' | 'patient' | 'user'
}

export interface UpcomingAppointment {
  id: number
  appointmentDate: string
  patientName: string
  providerName: string
  status: 'confirmed' | 'scheduled' | 'cancelled'
}

export interface RecentSupportTicket {
  id: number
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  createdAt: string
  userEmail: string
}

export interface RecentUserReport {
  id: number
  reportType: 'safety_concern' | 'spam' | 'technical_issue' | 'inappropriate_behavior' | 'fraud'
  status: 'pending' | 'in_progress' | 'escalated' | 'resolved' | 'rejected'
  createdAt: string
  reporterEmail: string
}

export interface DashboardActivity {
  recentUsers: RecentUser[]
  // Optionnelles - non présentes dans l'API actuelle  
  upcomingAppointments?: UpcomingAppointment[]
  recentSupportTickets?: RecentSupportTicket[]
  recentUserReports?: RecentUserReport[]
}

export interface DashboardData {
  stats: DashboardStats
  activity: DashboardActivity
}

export interface DashboardResponse {
  success: boolean
  data: DashboardData
  message: string
}