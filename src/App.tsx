import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  FlaskConical,
  Gauge,
  KeyRound,
  Menu,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from './api'
import type {
  Dataset,
  DatasetCase,
  DimensionKey,
  Evaluation,
  ExperimentCreate,
  ExperimentDetail,
  ExperimentResponse,
  ExperimentSummary,
  JudgePreset,
  ModelCatalogItem,
  Overview,
  ReviewItem,
} from './types'
import './App.css'

type View = 'overview' | 'experiments' | 'review' | 'datasets'

const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
  { key: 'instruction_following', label: 'Instruction following' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'language_quality', label: 'Language quality' },
  { key: 'safety', label: 'Safety' },
]

const FAILURE_TAGS = [
  'instruction_miss',
  'hallucination',
  'unsupported_claim',
  'format_error',
  'language_mismatch',
  'unsafe_content',
  'over_refusal',
  'incomplete',
  'irrelevant',
]

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical },
  { id: 'review', label: 'Review queue', icon: ClipboardCheck },
  { id: 'datasets', label: 'Datasets', icon: Database },
]

const JUDGE_PRESET_ICONS: Record<JudgePreset['key'], typeof Activity> = {
  economical: CircleDollarSign,
  reasoning: Gauge,
  strong: ShieldCheck,
  independent: SlidersHorizontal,
  bilingual: Activity,
}

const EMPTY_DIMENSIONS: Record<DimensionKey, number> = {
  instruction_following: 0,
  accuracy: 0,
  relevance: 0,
  language_quality: 0,
  safety: 0,
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function modelName(value: string) {
  return value.includes('/') ? value.split('/').at(-1) : value
}

function modelProvider(value: string) {
  return value.split('/', 1)[0].replace(/^~/, '')
}

function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`
  return `${tokens} ctx`
}

function formatModelPrice(model: ModelCatalogItem) {
  if (model.prompt_price_per_million === 0 && model.completion_price_per_million === 0) return 'Free'
  if (model.prompt_price_per_million < 0 || model.completion_price_per_million < 0) return 'Router pricing'
  const input = Number(model.prompt_price_per_million.toFixed(4))
  const output = Number(model.completion_price_per_million.toFixed(4))
  return `$${input} / $${output} per M`
}

function scoreClass(score: number) {
  if (score >= 85) return 'score-good'
  if (score >= 65) return 'score-mid'
  return 'score-low'
}

function ScoreBadge({ score }: { score: number }) {
  return <span className={`score-badge ${scoreClass(score)}`}>{Math.round(score)}</span>
}

function StatusBadge({ experiment }: { experiment: ExperimentSummary }) {
  const isComplete = experiment.status === 'completed'
  const hasErrors = experiment.status === 'completed_with_errors' || experiment.status === 'failed'
  return (
    <span className={`status status-${experiment.status}`}>
      {isComplete ? <CheckCircle2 size={13} /> : hasErrors ? <TriangleAlert size={13} /> : <Clock3 size={13} />}
      {experiment.mode === 'demo' && isComplete ? 'SIMULATION' : experiment.status.replaceAll('_', ' ').toUpperCase()}
    </span>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <Search size={20} />
      <span>{label}</span>
    </div>
  )
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [judgePresets, setJudgePresets] = useState<JudgePreset[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogItem[]>([])
  const [selectedExperimentId, setSelectedExperimentId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ExperimentDetail | null>(null)
  const [selectedResponseId, setSelectedResponseId] = useState<number | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null)
  const [datasetDetail, setDatasetDetail] = useState<Dataset | null>(null)
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null)
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([])
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null)
  const [unreviewedOnly, setUnreviewedOnly] = useState(true)
  const [showRunModal, setShowRunModal] = useState(false)

  const loadCore = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const [overviewData, datasetData, experimentData, modelData] = await Promise.all([
        api.overview(),
        api.datasets(),
        api.experiments(),
        api.models(),
      ])
      setOverview(overviewData)
      setDatasets(datasetData)
      setExperiments(experimentData)
      setJudgePresets(modelData.judge_presets)
      setModelCatalog(modelData.catalog)
      setSelectedExperimentId((current) => current ?? experimentData[0]?.id ?? null)
      setSelectedDatasetId((current) => current ?? datasetData[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the evaluation lab.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  const loadExperiment = useCallback(async (id: number) => {
    try {
      const data = await api.experiment(id)
      setDetail(data)
      setSelectedResponseId((current) =>
        data.responses.some((response) => response.id === current) ? current : data.responses[0]?.id ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load experiment.')
    }
  }, [])

  useEffect(() => {
    if (!selectedExperimentId) return
    void loadExperiment(selectedExperimentId)
  }, [loadExperiment, selectedExperimentId])

  useEffect(() => {
    const selected = experiments.find((item) => item.id === selectedExperimentId)
    if (!selected || !['queued', 'running'].includes(selected.status)) return
    const timer = window.setInterval(async () => {
      await loadCore(true)
      await loadExperiment(selected.id)
    }, 1800)
    return () => window.clearInterval(timer)
  }, [experiments, loadCore, loadExperiment, selectedExperimentId])

  useEffect(() => {
    if (!selectedDatasetId) return
    api.dataset(selectedDatasetId)
      .then((data) => {
        setDatasetDetail(data)
        setSelectedCaseId((current) =>
          data.cases?.some((item) => item.id === current) ? current : data.cases?.[0]?.id ?? null,
        )
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load dataset.'))
  }, [selectedDatasetId])

  const loadReviews = useCallback(async () => {
    try {
      const data = await api.reviewQueue(undefined, unreviewedOnly)
      setReviewQueue(data)
      setSelectedReviewId((current) =>
        data.some((item) => item.id === current) ? current : data[0]?.id ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load review queue.')
    }
  }, [unreviewedOnly])

  useEffect(() => {
    if (view === 'review') void loadReviews()
  }, [loadReviews, view])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectedResponse = detail?.responses.find((response) => response.id === selectedResponseId) ?? null
  const selectedReview = reviewQueue.find((item) => item.id === selectedReviewId) ?? null
  const selectedCase = datasetDetail?.cases?.find((item) => item.id === selectedCaseId) ?? null

  const switchView = (next: View) => {
    setView(next)
    setMobileNav(false)
  }

  const handleCreated = async (experiment: ExperimentSummary) => {
    setShowRunModal(false)
    setSelectedExperimentId(experiment.id)
    setView('experiments')
    setNotice(experiment.mode === 'demo' ? 'Simulation run completed.' : 'Live experiment started.')
    await loadCore(true)
    await loadExperiment(experiment.id)
  }

  const handleReviewSaved = async () => {
    setNotice('Human review saved.')
    await Promise.all([loadReviews(), loadCore(true)])
    if (selectedExperimentId) await loadExperiment(selectedExperimentId)
  }

  const pageTitle = NAV_ITEMS.find((item) => item.id === view)?.label ?? 'Overview'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><FlaskConical size={20} /></div>
          <div>
            <strong>QA.LAB</strong>
            <span>LLM reliability</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-active' : ''}
                onClick={() => switchView(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === 'review' && overview && overview.response_count - overview.human_review_count > 0 && (
                  <b>{overview.response_count - overview.human_review_count}</b>
                )}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <span>Evaluation operator</span>
          <strong>Ahmed Elsaid</strong>
          <small>Arabic / English QA</small>
        </div>
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main>
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" title="Open navigation" onClick={() => setMobileNav(true)}>
              <Menu size={19} />
            </button>
            <div>
              <span>Evaluation workspace</span>
              <h1>{pageTitle}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`api-state ${overview?.openrouter_env_configured ? 'api-ready' : ''}`}>
              <Server size={15} />
              {overview?.openrouter_env_configured ? 'OpenRouter ready' : 'Session key'}
            </span>
            <button className="icon-button" title="Refresh data" onClick={() => void loadCore(true)} disabled={refreshing}>
              <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
            </button>
            <button className="primary-button" onClick={() => setShowRunModal(true)}>
              <Play size={16} fill="currentColor" />
              Run experiment
            </button>
          </div>
        </header>

        {error && (
          <div className="banner banner-error">
            <TriangleAlert size={17} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button>
          </div>
        )}
        {notice && <div className="toast"><Check size={16} />{notice}</div>}

        <div className="workspace">
          {loading ? (
            <div className="loading-state"><RefreshCw size={22} className="spin" />Loading evaluation workspace</div>
          ) : (
            <>
              {view === 'overview' && overview && (
                <OverviewView
                  overview={overview}
                  onExperiment={(id) => { setSelectedExperimentId(id); setView('experiments') }}
                />
              )}
              {view === 'experiments' && (
                <ExperimentsView
                  experiments={experiments}
                  selectedId={selectedExperimentId}
                  onSelect={setSelectedExperimentId}
                  detail={detail}
                  selectedResponse={selectedResponse}
                  onResponse={setSelectedResponseId}
                />
              )}
              {view === 'review' && (
                <ReviewView
                  queue={reviewQueue}
                  selected={selectedReview}
                  onSelect={setSelectedReviewId}
                  unreviewedOnly={unreviewedOnly}
                  onToggle={() => setUnreviewedOnly((value) => !value)}
                  onSaved={handleReviewSaved}
                  onError={setError}
                />
              )}
              {view === 'datasets' && (
                <DatasetsView
                  datasets={datasets}
                  selectedDatasetId={selectedDatasetId}
                  onDataset={setSelectedDatasetId}
                  dataset={datasetDetail}
                  selectedCase={selectedCase}
                  onCase={setSelectedCaseId}
                />
              )}
            </>
          )}
        </div>
      </main>

      {showRunModal && (
        <RunExperimentModal
          datasets={datasets}
          judgePresets={judgePresets}
          modelCatalog={modelCatalog}
          envKeyConfigured={Boolean(overview?.openrouter_env_configured)}
          onClose={() => setShowRunModal(false)}
          onCreated={handleCreated}
          onError={setError}
        />
      )}
    </div>
  )
}

function OverviewView({ overview, onExperiment }: { overview: Overview; onExperiment: (id: number) => void }) {
  const scoreData = [...overview.recent_experiments].reverse().map((item) => ({
    name: `#${item.id}`,
    score: item.average_score,
    latency: item.average_latency,
  }))
  const failureData = overview.failure_taxonomy.length ? overview.failure_taxonomy : [{ tag: 'none', count: 0 }]
  const barColors = ['#d8644f', '#c18b2f', '#2d63a4', '#0f766e', '#74569a', '#66736e']

  return (
    <div className="view-stack">
      <section className="kpi-grid" aria-label="Quality metrics">
        <article>
          <span><Gauge size={16} />Mean quality</span>
          <strong>{overview.average_score.toFixed(1)}</strong>
          <small>automatic score / 100</small>
        </article>
        <article>
          <span><FlaskConical size={16} />Experiments</span>
          <strong>{overview.experiment_count}</strong>
          <small>{overview.response_count} model responses</small>
        </article>
        <article>
          <span><ClipboardCheck size={16} />Human coverage</span>
          <strong>{overview.human_coverage}%</strong>
          <small>{overview.human_review_count} calibrated responses</small>
        </article>
        <article>
          <span><Database size={16} />Benchmark cases</span>
          <strong>{overview.case_count}</strong>
          <small>Arabic and English</small>
        </article>
      </section>

      <section className="analytics-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><span>Regression signal</span><h2>Quality by experiment</h2></div>
            <BarChart3 size={18} />
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scoreData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#dfe4df" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#68716e', fontSize: 12 }} />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#68716e', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 6, borderColor: '#d7ddd8', fontSize: 12 }} />
                <Line type="monotone" dataKey="score" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 4, fill: '#0f766e' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><span>Error analysis</span><h2>Failure taxonomy</h2></div>
            <TriangleAlert size={18} />
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={failureData} layout="vertical" margin={{ top: 4, right: 12, left: 18, bottom: 0 }}>
                <CartesianGrid stroke="#dfe4df" strokeDasharray="3 4" horizontal={false} />
                <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#68716e', fontSize: 12 }} />
                <YAxis dataKey="tag" type="category" width={108} axisLine={false} tickLine={false} tick={{ fill: '#4b5552', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 6, borderColor: '#d7ddd8', fontSize: 12 }} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {failureData.map((entry, index) => <Cell key={entry.tag} fill={barColors[index % barColors.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span>Run history</span><h2>Recent experiments</h2></div>
          <span className="count-label">{overview.recent_experiments.length} shown</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Experiment</th><th>Mode</th><th>Models</th><th>Score</th><th>Latency</th><th>Created</th><th /></tr></thead>
            <tbody>
              {overview.recent_experiments.map((item) => (
                <tr key={item.id} onClick={() => onExperiment(item.id)}>
                  <td><strong>{item.name}</strong><small>#{item.id}</small></td>
                  <td><StatusBadge experiment={item} /></td>
                  <td>{item.models.length}</td>
                  <td><ScoreBadge score={item.average_score} /></td>
                  <td>{item.average_latency} ms</td>
                  <td>{formatDate(item.created_at)}</td>
                  <td><ChevronRight size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function ExperimentsView({
  experiments,
  selectedId,
  onSelect,
  detail,
  selectedResponse,
  onResponse,
}: {
  experiments: ExperimentSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  detail: ExperimentDetail | null
  selectedResponse: ExperimentResponse | null
  onResponse: (id: number) => void
}) {
  return (
    <div className="split-view experiment-layout">
      <section className="list-rail panel">
        <div className="panel-heading compact-heading">
          <div><span>History</span><h2>Experiment runs</h2></div>
          <b>{experiments.length}</b>
        </div>
        <div className="rail-list">
          {experiments.map((item) => (
            <button key={item.id} className={selectedId === item.id ? 'rail-active' : ''} onClick={() => onSelect(item.id)}>
              <div><strong>{item.name}</strong><small>{formatDate(item.created_at)}</small></div>
              <div><ScoreBadge score={item.average_score} /><ChevronRight size={15} /></div>
            </button>
          ))}
        </div>
      </section>

      <div className="detail-column">
        {!detail ? <EmptyState label="Select an experiment" /> : (
          <>
            <section className="panel experiment-head">
              <div>
                <span className="eyebrow">Experiment #{detail.experiment.id}</span>
                <h2>{detail.experiment.name}</h2>
                <div className="inline-meta">
                  <StatusBadge experiment={detail.experiment} />
                  <span>{detail.experiment.response_count} responses</span>
                  <span>{formatDate(detail.experiment.completed_at || detail.experiment.created_at)}</span>
                </div>
                {detail.experiment.error && <div className="experiment-error"><TriangleAlert size={14} />{detail.experiment.error}</div>}
              </div>
              <a className="secondary-button" href={`/api/experiments/${detail.experiment.id}/export.csv`}>
                <Download size={16} />Export CSV
              </a>
            </section>

            <section className="metric-strip">
              {detail.model_metrics.map((metric) => (
                <article key={metric.model}>
                  <div><strong>{modelName(metric.model)}</strong><small>{metric.model}</small></div>
                  <ScoreBadge score={metric.average_score} />
                  <span><Timer size={14} />{metric.average_latency} ms</span>
                  <span><CircleDollarSign size={14} />${metric.total_cost.toFixed(4)}</span>
                </article>
              ))}
            </section>

            <section className="panel table-panel">
              <div className="panel-heading compact-heading">
                <div><span>Response matrix</span><h2>Case results</h2></div>
                <span className="count-label">click row to inspect</span>
              </div>
              <div className="table-scroll results-table">
                <table>
                  <thead><tr><th>Case</th><th>Model</th><th>Language</th><th>Auto</th><th>Human</th><th>Latency</th></tr></thead>
                  <tbody>
                    {detail.responses.map((response) => (
                      <tr key={response.id} className={selectedResponse?.id === response.id ? 'selected-row' : ''} onClick={() => onResponse(response.id)}>
                        <td><strong>{response.case_title}</strong><small>{response.category}</small></td>
                        <td title={response.model}>{modelName(response.model)}</td>
                        <td>{response.language}</td>
                        <td><ScoreBadge score={response.automatic_evaluation?.overall_score ?? 0} /></td>
                        <td>{response.human_evaluation ? <ScoreBadge score={response.human_evaluation.overall_score} /> : <span className="muted">—</span>}</td>
                        <td>{response.latency_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {selectedResponse && <ResponseInspector response={selectedResponse} />}
          </>
        )}
      </div>
    </div>
  )
}

function ResponseInspector({ response }: { response: ExperimentResponse }) {
  return (
    <section className="panel response-inspector">
      <div className="panel-heading">
        <div><span>Response inspector</span><h2>{response.case_title}</h2></div>
        <span className="tag">{response.language}</span>
      </div>
      <div className="response-columns">
        <div>
          <label>Prompt</label>
          <pre dir="auto">{response.prompt}</pre>
          <label>Expected behavior</label>
          <p dir="auto">{response.expected_behavior}</p>
        </div>
        <div>
          <label>Model output</label>
          <pre className="model-output" dir="auto">{response.content}</pre>
        </div>
      </div>
      {response.automatic_evaluation && (
        <div className="dimension-row">
          {DIMENSIONS.map((dimension) => (
            <div key={dimension.key}>
              <span>{dimension.label}</span>
              <strong>{response.automatic_evaluation?.dimensions[dimension.key]?.toFixed(1) ?? '0.0'}</strong>
              <i style={{ width: `${(response.automatic_evaluation?.dimensions[dimension.key] ?? 0) * 20}%` }} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ReviewView({
  queue,
  selected,
  onSelect,
  unreviewedOnly,
  onToggle,
  onSaved,
  onError,
}: {
  queue: ReviewItem[]
  selected: ReviewItem | null
  onSelect: (id: number) => void
  unreviewedOnly: boolean
  onToggle: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Evaluation>({
    overall_score: 0,
    dimensions: EMPTY_DIMENSIONS,
    failure_tags: [],
    notes: '',
  })

  useEffect(() => {
    if (!selected) return
    setForm({
      overall_score: selected.automatic_evaluation.overall_score,
      dimensions: { ...EMPTY_DIMENSIONS, ...selected.automatic_evaluation.dimensions },
      failure_tags: [...selected.automatic_evaluation.failure_tags],
      notes: '',
    })
  }, [selected])

  const setDimension = (key: DimensionKey, value: number) => {
    const dimensions = { ...form.dimensions, [key]: value }
    const overall = (Object.values(dimensions).reduce((sum, item) => sum + item, 0) / 25) * 100
    setForm({ ...form, dimensions, overall_score: Math.round(overall * 10) / 10 })
  }

  const toggleTag = (tag: string) => {
    setForm({
      ...form,
      failure_tags: form.failure_tags.includes(tag)
        ? form.failure_tags.filter((item) => item !== tag)
        : [...form.failure_tags, tag],
    })
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await api.saveReview(selected.id, form)
      await onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save review.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="split-view review-layout">
      <section className="list-rail panel">
        <div className="panel-heading compact-heading">
          <div><span>Calibration</span><h2>Response queue</h2></div>
          <button className={`filter-button ${unreviewedOnly ? 'filter-active' : ''}`} title="Toggle reviewed responses" onClick={onToggle}>
            <SlidersHorizontal size={15} />
          </button>
        </div>
        <div className="rail-list review-list">
          {queue.map((item) => (
            <button key={item.id} className={selected?.id === item.id ? 'rail-active' : ''} onClick={() => onSelect(item.id)}>
              <div><strong>{item.case_title}</strong><small>{modelName(item.model)}</small></div>
              <ScoreBadge score={item.automatic_evaluation.overall_score} />
            </button>
          ))}
          {!queue.length && <EmptyState label="Queue is clear" />}
        </div>
      </section>

      {!selected ? <EmptyState label="Select a response to review" /> : (
        <section className="panel review-editor">
          <div className="panel-heading">
            <div><span>{selected.experiment_name}</span><h2>{selected.case_title}</h2></div>
            <div className="review-score"><small>Human score</small><strong>{Math.round(form.overall_score)}</strong></div>
          </div>

          <div className="review-content-grid">
            <div>
              <label>Prompt</label>
              <pre dir="auto">{selected.prompt}</pre>
              <label>Expected behavior</label>
              <p dir="auto">{selected.expected_behavior}</p>
            </div>
            <div>
              <label>Model output · {modelName(selected.model)}</label>
              <pre className="model-output" dir="auto">{selected.content}</pre>
            </div>
          </div>

          <div className="review-controls">
            <div className="slider-stack">
              {DIMENSIONS.map((dimension) => (
                <label key={dimension.key}>
                  <span>{dimension.label}<b>{form.dimensions[dimension.key].toFixed(1)}</b></span>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={form.dimensions[dimension.key]}
                    onChange={(event) => setDimension(dimension.key, Number(event.target.value))}
                  />
                </label>
              ))}
            </div>
            <div className="taxonomy-editor">
              <label>Failure tags</label>
              <div className="tag-grid">
                {FAILURE_TAGS.map((tag) => (
                  <button key={tag} className={form.failure_tags.includes(tag) ? 'tag-selected' : ''} onClick={() => toggleTag(tag)}>
                    {form.failure_tags.includes(tag) && <Check size={13} />}{tag}
                  </button>
                ))}
              </div>
              <label htmlFor="review-notes">Reviewer notes</label>
              <textarea id="review-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Calibration notes and rationale" />
            </div>
          </div>

          <div className="editor-actions">
            <span>Auto score: {selected.automatic_evaluation.overall_score.toFixed(1)}</span>
            <button className="primary-button" onClick={() => void save()} disabled={saving}>
              {saving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}Save review
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function DatasetsView({
  datasets,
  selectedDatasetId,
  onDataset,
  dataset,
  selectedCase,
  onCase,
}: {
  datasets: Dataset[]
  selectedDatasetId: number | null
  onDataset: (id: number) => void
  dataset: Dataset | null
  selectedCase: DatasetCase | null
  onCase: (id: number) => void
}) {
  return (
    <div className="dataset-view">
      <section className="dataset-tabs">
        {datasets.map((item) => (
          <button key={item.id} className={selectedDatasetId === item.id ? 'dataset-active' : ''} onClick={() => onDataset(item.id)}>
            <Database size={16} /><span>{item.name}</span><b>{item.case_count}</b>
          </button>
        ))}
      </section>
      {dataset && (
        <section className="panel dataset-summary">
          <div><span className="eyebrow">Benchmark dataset</span><h2>{dataset.name}</h2><p>{dataset.description}</p></div>
          <div className="dataset-facts"><span><Database size={15} />{dataset.cases?.length ?? 0} cases</span><span><ShieldCheck size={15} />{dataset.language_mix}</span></div>
        </section>
      )}
      <div className="dataset-grid">
        <section className="panel case-list">
          <div className="panel-heading compact-heading"><div><span>Coverage</span><h2>Evaluation cases</h2></div></div>
          {dataset?.cases?.map((item, index) => (
            <button key={item.id} className={selectedCase?.id === item.id ? 'case-active' : ''} onClick={() => onCase(item.id)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{item.title}</strong><small>{item.category} · {item.language}</small></div>
              <ChevronRight size={15} />
            </button>
          ))}
        </section>
        {selectedCase ? (
          <section className="panel case-detail">
            <div className="panel-heading"><div><span>{selectedCase.category}</span><h2>{selectedCase.title}</h2></div><span className="tag">{selectedCase.language}</span></div>
            <label>Prompt</label><pre dir="auto">{selectedCase.prompt}</pre>
            <label>Expected behavior</label><p dir="auto">{selectedCase.expected_behavior}</p>
            <div className="term-grid">
              <div><label>Required signals</label>{selectedCase.required_terms.length ? selectedCase.required_terms.map((term) => <span key={term}>{term}</span>) : <small>Rubric judged</small>}</div>
              <div><label>Forbidden signals</label>{selectedCase.forbidden_terms.length ? selectedCase.forbidden_terms.map((term) => <span key={term}>{term}</span>) : <small>None</small>}</div>
            </div>
          </section>
        ) : <EmptyState label="Select an evaluation case" />}
      </div>
    </div>
  )
}

function RunExperimentModal({
  datasets,
  judgePresets,
  modelCatalog,
  envKeyConfigured,
  onClose,
  onCreated,
  onError,
}: {
  datasets: Dataset[]
  judgePresets: JudgePreset[]
  modelCatalog: ModelCatalogItem[]
  envKeyConfigured: boolean
  onClose: () => void
  onCreated: (experiment: ExperimentSummary) => Promise<void>
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [name, setName] = useState(`Reliability run ${new Date().toLocaleDateString('en-GB')}`)
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? 0)
  const [selectedModels, setSelectedModels] = useState<string[]>(['Demo / Calibrated', 'Demo / Drifted'])
  const [customModel, setCustomModel] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [judgeModel, setJudgeModel] = useState(judgePresets[0]?.model ?? 'openai/gpt-4o-mini')
  const [judgePickerOpen, setJudgePickerOpen] = useState(false)
  const [judgeSearch, setJudgeSearch] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const changeMode = (next: 'demo' | 'live') => {
    setFormError('')
    setMode(next)
    setSelectedModels(next === 'demo' ? ['Demo / Calibrated', 'Demo / Drifted'] : [])
  }

  const toggleModel = (model: string) => {
    setSelectedModels((current) => {
      if (current.includes(model)) return current.filter((item) => item !== model)
      if (current.length >= 4) {
        setFormError('You can compare up to four models in one experiment.')
        return current
      }
      setFormError('')
      return [...current, model]
    })
  }

  const addCustom = () => {
    const value = customModel.trim()
    if (/^(sk-|bearer\s)/i.test(value)) {
      setFormError('That looks like an API key. Enter it only in the OpenRouter API key field.')
      return
    }
    if (value && (!value.includes('/') || /\s/.test(value))) {
      setFormError('A model ID must use the provider/model format.')
      return
    }
    if (value && !selectedModels.includes(value) && selectedModels.length < 4) {
      setSelectedModels([...selectedModels, value])
      setFormError('')
    }
    setCustomModel('')
  }

  const chooseJudge = (model: string) => {
    setJudgeModel(model)
    setJudgePickerOpen(false)
    setJudgeSearch('')
    setFormError('')
  }

  const applyExactJudgeId = () => {
    const value = judgeSearch.trim()
    if (/^(sk-|bearer\s)/i.test(value)) {
      setFormError('That looks like an API key. Enter it only in the OpenRouter API key field.')
      return
    }
    if (!value.includes('/') || /\s/.test(value)) {
      setFormError('A judge ID must use the provider/model format.')
      return
    }
    chooseJudge(value)
  }

  const submit = async () => {
    if (!datasetId || !selectedModels.length) return
    setFormError('')
    setSubmitting(true)
    const payload: ExperimentCreate = {
      name,
      dataset_id: datasetId,
      models: selectedModels,
      judge_model: mode === 'live' ? judgeModel : 'Deterministic simulation evaluator',
      mode,
      ...(apiKey ? { api_key: apiKey } : {}),
    }
    try {
      const experiment = await api.createExperiment(payload)
      await onCreated(experiment)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create experiment.'
      setFormError(message)
      onError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const providers = useMemo(
    () => [...new Set(modelCatalog.map((model) => model.provider))].sort((a, b) => a.localeCompare(b)),
    [modelCatalog],
  )

  const judgeDetails = modelCatalog.find((model) => model.id === judgeModel)
  const activeJudgePreset = judgePresets.find((preset) => preset.model === judgeModel)
  const judgeProvider = judgeDetails?.provider ?? modelProvider(judgeModel)
  const judgeIsCandidate = selectedModels.includes(judgeModel)
  const judgeSharesProvider = !judgeIsCandidate && selectedModels.some((model) => modelProvider(model) === judgeProvider)

  const judgeResults = useMemo(() => {
    const query = judgeSearch.trim().toLocaleLowerCase()
    return modelCatalog
      .filter((model) => !query || `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(query))
      .slice(0, 12)
  }, [judgeSearch, modelCatalog])

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase()
    return modelCatalog
      .filter((model) => {
        if (providerFilter === 'all') return true
        if (providerFilter === 'free') return model.prompt_price_per_million === 0 && model.completion_price_per_million === 0
        return model.provider === providerFilter
      })
      .filter((model) => !query || `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(query))
  }, [modelCatalog, modelSearch, providerFilter])

  const visibleModels = filteredModels.slice(0, 80)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="run-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span>New benchmark</span><h2 id="run-title">Run experiment</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="mode-control" role="group" aria-label="Experiment mode">
          <button className={mode === 'demo' ? 'mode-active' : ''} onClick={() => changeMode('demo')}><FlaskConical size={16} />Simulation</button>
          <button className={mode === 'live' ? 'mode-active' : ''} onClick={() => changeMode('live')}><Server size={16} />Live OpenRouter</button>
        </div>

        <div className={`mode-notice ${mode === 'live' ? 'live-notice' : ''}`}>
          {mode === 'demo' ? <Activity size={17} /> : <KeyRound size={17} />}
          <span>{mode === 'demo' ? 'Synthetic outputs · no API calls or cost' : 'Real model calls · API usage may incur cost'}</span>
        </div>

        <div className="form-grid">
          <label className="field-full">Experiment name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field-full">Dataset<select value={datasetId} onChange={(event) => setDatasetId(Number(event.target.value))}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
        </div>

        {mode === 'live' && !envKeyConfigured && (
          <label className="field-full api-key-field">OpenRouter API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-or-v1-..." /><small>Used for this run only. It is never saved in the database.</small></label>
        )}

        {mode === 'live' && (
          <fieldset className="judge-fieldset">
            <legend>Judge strategy</legend>
            <div className="judge-presets">
              {judgePresets.map((preset) => {
                const Icon = JUDGE_PRESET_ICONS[preset.key]
                return (
                  <button key={preset.key} type="button" title={preset.description} className={!judgePickerOpen && activeJudgePreset?.key === preset.key ? 'judge-preset-active' : ''} onClick={() => chooseJudge(preset.model)}>
                    <Icon size={16} /><span><strong>{preset.label}</strong><small>{modelName(preset.model)}</small></span>
                  </button>
                )
              })}
              <button type="button" className={judgePickerOpen || !activeJudgePreset ? 'judge-preset-active' : ''} onClick={() => setJudgePickerOpen((value) => !value)}>
                <Search size={16} /><span><strong>Custom</strong><small>Any OpenRouter model</small></span>
              </button>
            </div>

            <div className="judge-selection">
              <div><span>{activeJudgePreset?.label ?? 'Custom'} judge</span><strong>{judgeDetails?.name ?? modelName(judgeModel)}</strong><small>{judgeModel}</small></div>
              <div>{judgeDetails && <><span>{formatContext(judgeDetails.context_length)}</span><span>{formatModelPrice(judgeDetails)}</span></>}</div>
            </div>

            {judgePickerOpen && (
              <div className="judge-picker">
                <label><Search size={15} /><input aria-label="Search judge model catalogue" placeholder="Search judge by name, provider, or exact ID" value={judgeSearch} onChange={(event) => setJudgeSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyExactJudgeId() } }} /></label>
                <div className="judge-results" aria-label="Judge model catalogue">
                  {judgeResults.map((model) => (
                    <button key={model.id} type="button" data-judge-model-id={model.id} onClick={() => chooseJudge(model.id)}>
                      <span>{model.provider}</span><strong>{model.name}</strong><small>{model.id} / {formatModelPrice(model)}</small>
                    </button>
                  ))}
                  {!judgeResults.length && <EmptyState label="No matching judge models" />}
                </div>
                <div className="judge-exact"><small>Exact IDs must exist in OpenRouter.</small><button type="button" disabled={!judgeSearch.trim()} onClick={applyExactJudgeId}>Use exact ID</button></div>
              </div>
            )}

            <p className="judge-help">{activeJudgePreset ? `${activeJudgePreset.description} ` : ''}The judge scores every response against the dataset rubric and is not counted as a comparison model.</p>
            {judgeIsCandidate && <div className="judge-warning"><TriangleAlert size={15} /><span>This judge is also being tested. Select an independent judge or verify the scores through human review.</span></div>}
            {judgeSharesProvider && <div className="judge-advisory"><ShieldCheck size={15} /><span>The judge shares a provider with a candidate model. A cross-provider judge can reduce family preference.</span></div>}
          </fieldset>
        )}

        <fieldset className="model-fieldset">
          <legend>Models · {selectedModels.length}/4 selected</legend>
          {mode === 'demo' ? (
            <div className="model-options">
              {['Demo / Calibrated', 'Demo / Drifted'].map((model) => (
                <button key={model} className={selectedModels.includes(model) ? 'model-selected' : ''} onClick={() => toggleModel(model)}>
                  <span>{modelName(model)}</span><small>{model}</small>{selectedModels.includes(model) && <Check size={15} />}
                </button>
              ))}
            </div>
          ) : (
            <div className="model-library">
              <div className="selected-models">
                {selectedModels.map((model) => (
                  <button key={model} title="Remove model" onClick={() => toggleModel(model)}>
                    <span>{modelName(model)}</span><X size={13} />
                  </button>
                ))}
                {!selectedModels.length && <span>No comparison models selected</span>}
              </div>
              <div className="model-library-tools">
                <label><Search size={15} /><input aria-label="Search model catalogue" placeholder="Search 300+ models" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} /></label>
                <select aria-label="Filter by provider" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                  <option value="all">All providers</option>
                  <option value="free">Free models</option>
                  {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </div>
              <div className="model-catalog-meta">
                <span>{filteredModels.length > visibleModels.length ? `Showing ${visibleModels.length} of ${filteredModels.length} models` : `${filteredModels.length} models`}</span>
                {(modelSearch || providerFilter !== 'all') && <button type="button" onClick={() => { setModelSearch(''); setProviderFilter('all') }}><X size={13} />Clear filters</button>}
              </div>
              <div className="model-catalog" aria-label="OpenRouter model catalogue">
                {visibleModels.map((model) => (
                  <button key={model.id} data-model-id={model.id} className={selectedModels.includes(model.id) ? 'catalog-selected' : ''} onClick={() => toggleModel(model.id)}>
                    <span className="model-provider">{model.provider}</span>
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                    <div><span>{formatContext(model.context_length)}</span><span>{model.modality}</span><span>{formatModelPrice(model)}</span></div>
                    {selectedModels.includes(model.id) && <Check size={15} />}
                  </button>
                ))}
                {!visibleModels.length && <EmptyState label="No matching models" />}
              </div>
              <div className="custom-model-wrap"><div className="custom-model"><input placeholder="Custom provider/model ID" value={customModel} onChange={(event) => setCustomModel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom() } }} /><button onClick={addCustom}>Add ID</button></div><small>Use an exact OpenRouter ID. Models outside OpenRouter require a separate provider integration.</small></div>
            </div>
          )}
        </fieldset>

        {formError && <div className="form-error"><TriangleAlert size={15} />{formError}</div>}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={submitting || name.trim().length < 3 || !selectedModels.length || (mode === 'live' && !envKeyConfigured && !apiKey)} onClick={() => void submit()}>
            {submitting ? <RefreshCw size={16} className="spin" /> : <Play size={16} fill="currentColor" />}{mode === 'demo' ? 'Run simulation' : 'Start live run'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
