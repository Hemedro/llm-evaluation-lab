export type DimensionKey =
  | 'instruction_following'
  | 'accuracy'
  | 'relevance'
  | 'language_quality'
  | 'safety'

export type ModelCatalogItem = {
  id: string
  name: string
  provider: string
  context_length: number
  modality: string
  prompt_price_per_million: number
  completion_price_per_million: number
  created: number
}

export type JudgePreset = {
  key: 'economical' | 'reasoning' | 'strong' | 'independent' | 'bilingual'
  label: string
  model: string
  description: string
}

export type Evaluation = {
  id?: number
  evaluator_type?: string
  overall_score: number
  dimensions: Record<DimensionKey, number>
  failure_tags: string[]
  notes: string
  updated_at?: string
}

export type DatasetCase = {
  id: number
  dataset_id: number
  title: string
  prompt: string
  language: string
  category: string
  expected_behavior: string
  rubric: string[]
  required_terms: string[]
  forbidden_terms: string[]
}

export type Dataset = {
  id: number
  name: string
  description: string
  language_mix: string
  case_count: number
  created_at: string
  cases?: DatasetCase[]
}

export type DatasetCreate = {
  name: string
  description: string
  language_mix: string
}

export type DatasetCaseCreate = {
  title: string
  prompt: string
  language: string
  category: string
  expected_behavior: string
  rubric: string[]
  required_terms: string[]
  forbidden_terms: string[]
}

export type ExperimentSummary = {
  id: number
  name: string
  dataset_id: number
  models: string[]
  judge_model: string | null
  mode: 'demo' | 'live'
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed'
  progress_completed: number
  progress_total: number
  created_at: string
  completed_at: string | null
  error: string | null
  average_score: number
  response_count: number
  average_latency: number
  total_cost: number
}

export type ModelMetric = {
  model: string
  average_score: number
  average_latency: number
  total_cost: number
  response_count: number
  human_reviewed: number
}

export type ExperimentResponse = {
  id: number
  case_id: number
  case_title: string
  prompt: string
  language: string
  category: string
  expected_behavior: string
  model: string
  content: string
  latency_ms: number
  prompt_tokens: number
  completion_tokens: number
  estimated_cost: number
  automatic_evaluation: Evaluation | null
  human_evaluation: Evaluation | null
}

export type ExperimentDetail = {
  experiment: ExperimentSummary
  model_metrics: ModelMetric[]
  responses: ExperimentResponse[]
}

export type ReviewItem = {
  id: number
  experiment_id: number
  experiment_name: string
  case_title: string
  prompt: string
  expected_behavior: string
  language: string
  category: string
  model: string
  content: string
  automatic_evaluation: Evaluation
  human_reviewed: boolean
}

export type Overview = {
  case_count: number
  experiment_count: number
  response_count: number
  human_review_count: number
  human_coverage: number
  average_score: number
  recent_experiments: ExperimentSummary[]
  failure_taxonomy: Array<{ tag: string; count: number }>
  openrouter_env_configured: boolean
}

export type ExperimentCreate = {
  name: string
  dataset_id: number
  models: string[]
  judge_model: string | null
  mode: 'demo' | 'live'
  api_key?: string
}
