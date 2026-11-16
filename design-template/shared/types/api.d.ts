export interface ApiResponse<T = any> {
  success: true
  data: T
  message: string
  pagination?: {
    current_page: number
    per_page: number
    total: number
    last_page: number
  }
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details: any[]
  }
}

export type ApiResult<T = any> = ApiResponse<T> | ApiErrorResponse

export interface PaginationParams {
  page?: number
  per_page?: number
}