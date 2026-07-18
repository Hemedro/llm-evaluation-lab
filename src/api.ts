import type {
  Dataset,
  Evaluation,
  ExperimentCreate,
  ExperimentDetail,
  ExperimentSummary,
  JudgePreset,
  ModelCatalogItem,
  Overview,
  ReviewItem,
} from './types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      message = body.detail || message
    } catch {
      // Preserve the HTTP status when the server does not return JSON.
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  models: () => request<{
    models: string[]
    judge_model: string
    judge_presets: JudgePreset[]
    custom_models_supported: boolean
    catalog_checked: boolean
    catalog: ModelCatalogItem[]
  }>('/api/models'),
  datasets: () => request<Dataset[]>('/api/datasets'),
  dataset: (id: number) => request<Dataset>(`/api/datasets/${id}`),
  experiments: () => request<ExperimentSummary[]>('/api/experiments'),
  experiment: (id: number) => request<ExperimentDetail>(`/api/experiments/${id}`),
  createExperiment: (payload: ExperimentCreate) =>
    request<ExperimentSummary>('/api/experiments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reviewQueue: (experimentId?: number, unreviewedOnly = true) => {
    const params = new URLSearchParams({ unreviewed_only: String(unreviewedOnly) })
    if (experimentId) params.set('experiment_id', String(experimentId))
    return request<ReviewItem[]>(`/api/review-queue?${params}`)
  },
  saveReview: (responseId: number, evaluation: Evaluation) =>
    request<Evaluation>(`/api/responses/${responseId}/human-review`, {
      method: 'POST',
      body: JSON.stringify(evaluation),
    }),
}
