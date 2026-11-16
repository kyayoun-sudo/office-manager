export interface Insurance {
  id: number
  libelle: string
  code: string
  type: string
  coveragePercentage?: number
  maxCoverage?: number
  isActive?: boolean
  description?: string
  createdAt: string
  updatedAt: string
}

export interface InsuranceFilters {
  type?: 'PUBLIC' | 'PRIVATE' | 'HYBRID'
  search?: string
  page?: number
  limit?: number
}

export interface InsurancesResponse {
  success: boolean
  data: Insurance[] | {
    data: Insurance[]
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasNextPage: boolean
      hasPrevPage: boolean
    }
  }
}

export interface CreateInsuranceRequest {
  libelle: string
  code: string
  type: string
  coveragePercentage?: number
  maxCoverage?: number
  isActive?: boolean
  description?: string
}

export interface UpdateInsuranceRequest {
  libelle?: string
  code?: string
  type?: string
  coveragePercentage?: number
  maxCoverage?: number
  isActive?: boolean
  description?: string
}

export interface InsuranceStats {
  total: number
  active: number
  inactive: number
  public: number
  private: number
  mutual: number
  hospital: number
  hybrid: number
}