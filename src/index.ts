import type {
  SeoLandingPageVisitsResult,
  SeoProviderActivate,
  SeoProviderConnection,
  SeoProviderRuntime,
} from 'seo/provider-sdk'

const CLICKY_ENDPOINT = 'https://api.clicky.com/api/stats/4'
const CLICKY_PAGE_LIMIT = 1_000
const CLICKY_MAX_ROWS = 5_000
const CLICKY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000

type ClickyItem = Record<string, unknown> & {
  value?: string | number
  value_percent?: string | number
  title?: string
  url?: string
  stats_url?: string
}

function invalidData(): never {
  throw new Error('Clicky returned invalid data.')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidData()
  }
  return value as Record<string, unknown>
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) invalidData()
  return value
}

function optionalValue(value: unknown): string | number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.length <= 128) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return invalidData()
}

function clickyItem(value: unknown): ClickyItem {
  const item = record(value)
  return {
    ...item,
    ...(item.value !== undefined ? { value: optionalValue(item.value) } : {}),
    ...(item.value_percent !== undefined
      ? { value_percent: optionalValue(item.value_percent) }
      : {}),
    ...(item.title !== undefined
      ? { title: optionalString(item.title, 4_096) }
      : {}),
    ...(item.url !== undefined ? { url: optionalString(item.url, 4_096) } : {}),
    ...(item.stats_url !== undefined
      ? { stats_url: optionalString(item.stats_url, 4_096) }
      : {}),
  }
}

function siteId(value: string): string {
  const normalized = value.trim()
  if (!/^\d{1,30}$/u.test(normalized)) {
    throw new Error('Clicky needs a numeric site ID.')
  }
  return normalized
}

function sitekey(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9]{12,64}$/u.test(normalized)) {
    throw new Error('Clicky needs a valid sitekey.')
  }
  return normalized
}

function retainedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Clicky limit must be a positive whole number.')
  }
  return Math.min(value, CLICKY_MAX_ROWS)
}

function connectionValues(connection: SeoProviderConnection): {
  siteId: string
  sitekey: string
} {
  return {
    siteId: siteId(connection.account.siteId ?? ''),
    sitekey: sitekey(connection.credentials.sitekey ?? ''),
  }
}

function dateRange(startDate: string, endDate: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(endDate)
  ) {
    throw new Error('Clicky dates must use YYYY-MM-DD.')
  }
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  const days = Math.floor((end - start) / 86_400_000) + 1
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    throw new Error('Clicky date ranges cannot be longer than 31 days.')
  }
  return `${startDate},${endDate}`
}

function optionalDateRange(
  startDate: unknown,
  endDate: unknown,
): { date?: string; range?: { startDate: string; endDate: string } } {
  if (startDate === undefined && endDate === undefined) return {}
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    throw new Error('Clicky startDate and endDate must be provided together.')
  }
  return {
    date: dateRange(startDate, endDate),
    range: { startDate, endDate },
  }
}

function reportType(value: unknown): string {
  const type = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(type)) {
    throw new Error('Clicky report type is invalid.')
  }
  return type
}

function positiveWholeNumber(
  value: unknown,
  fallback: number,
  label: string,
): number {
  const number = value === undefined ? fallback : value
  if (!Number.isSafeInteger(number) || (number as number) < 1) {
    throw new Error(`Clicky ${label} must be a positive whole number.`)
  }
  return number as number
}

function clickyItems(value: unknown, type: string): ClickyItem[] {
  if (!Array.isArray(value)) throw new Error('Clicky returned invalid data.')
  const groups = value.map((item) => {
    const group = record(item)
    optionalString(group.type, 64)
    optionalString(group.error, 2_000)
    if (group.dates !== undefined && !Array.isArray(group.dates)) invalidData()
    for (const dateValue of group.dates ?? []) {
      const date = record(dateValue)
      optionalString(date.date, 64)
      if (date.items !== undefined && !Array.isArray(date.items)) invalidData()
      for (const item of date.items ?? []) clickyItem(item)
    }
    return group
  })
  const providerError = groups.find(
    (group) => typeof group.error === 'string',
  )?.error
  if (typeof providerError === 'string') {
    const error = new Error(
      /sitekey|site id|authentication|permission/iu.test(providerError)
        ? 'Clicky rejected the configured site ID or sitekey.'
        : `Clicky could not run the ${type} report.`,
    ) as Error & { code?: string }
    error.code = /sitekey|site id|authentication|permission/iu.test(
      providerError,
    )
      ? 'authentication'
      : 'remote-error'
    throw error
  }
  return groups
    .filter((group) => group.type === type && Array.isArray(group.dates))
    .flatMap((group) => group.dates as unknown[])
    .flatMap((item) => {
      const date = record(item)
      return Array.isArray(date.items) ? date.items.map(clickyItem) : []
    })
}

async function request(input: {
  connection: SeoProviderConnection
  runtime: SeoProviderRuntime
  type: string
  limit: number
  page: number
  date?: string
}): Promise<unknown[]> {
  const values = connectionValues(input.connection)
  const url = new URL(CLICKY_ENDPOINT)
  url.searchParams.set('site_id', values.siteId)
  url.searchParams.set('sitekey', values.sitekey)
  url.searchParams.set('type', input.type)
  url.searchParams.set('output', 'json')
  url.searchParams.set('limit', String(input.limit))
  url.searchParams.set('page', String(input.page))
  url.searchParams.set('app', 'seo')
  if (input.date) url.searchParams.set('date', input.date)
  return clickyItems(
    await input.runtime.requestJson({
      operation: input.type,
      url: url.toString(),
    }),
    input.type,
  )
}

async function nativeReport(
  input: SeoProviderConnection & {
    params: Readonly<Record<string, string | number | boolean | null>>
  },
  runtime: SeoProviderRuntime,
) {
  const type = reportType(input.params.type ?? 'pages-entrance')
  const retainedRowLimit = retainedLimit(
    positiveWholeNumber(input.params.limit, CLICKY_PAGE_LIMIT, 'limit'),
  )
  const page = positiveWholeNumber(input.params.page, 1, 'page')
  const dates = optionalDateRange(input.params.startDate, input.params.endDate)
  const rows: unknown[] = []
  let currentPage = page
  while (rows.length < retainedRowLimit) {
    const requestLimit = Math.min(
      CLICKY_PAGE_LIMIT,
      retainedRowLimit - rows.length,
    )
    const batch = await request({
      connection: input,
      runtime,
      type,
      limit: requestLimit,
      page: currentPage,
      date: dates.date,
    })
    rows.push(...batch.slice(0, requestLimit))
    if (batch.length < requestLimit) break
    currentPage += 1
  }
  return {
    siteId: siteId(input.account.siteId ?? ''),
    type,
    ...(dates.range ? { range: dates.range } : {}),
    rows,
    returnedRows: rows.length,
    retainedRowLimit,
    retainedRowLimitReached: rows.length >= retainedRowLimit,
  }
}

async function verify(
  connection: SeoProviderConnection,
  runtime: SeoProviderRuntime,
): Promise<void> {
  await request({ connection, runtime, type: 'visitors', limit: 1, page: 1 })
}

async function landingPages(
  input: SeoProviderConnection & {
    startDate: string
    endDate: string
    limit: number
  },
  runtime: SeoProviderRuntime,
): Promise<SeoLandingPageVisitsResult> {
  const retainedRowLimit = retainedLimit(input.limit)
  const date = dateRange(input.startDate, input.endDate)
  const items: unknown[] = []
  let page = 1
  while (items.length < retainedRowLimit) {
    const requestLimit = Math.min(
      CLICKY_PAGE_LIMIT,
      retainedRowLimit - items.length,
    )
    const batch = await request({
      connection: input,
      runtime,
      type: 'pages-entrance',
      limit: requestLimit,
      page,
      date,
    })
    items.push(...batch.slice(0, requestLimit))
    if (batch.length < requestLimit) break
    page += 1
  }

  const visitsByPath = new Map<string, number>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row.url !== 'string') continue
    const visits = Number(row.value)
    if (!Number.isSafeInteger(visits) || visits < 0) continue
    try {
      const path = new URL(row.url).pathname.replace(/\/$/u, '') || '/'
      visitsByPath.set(path, (visitsByPath.get(path) ?? 0) + visits)
    } catch {
      // Invalid provider rows do not become report evidence.
    }
  }
  const retainedRowLimitReached = items.length >= retainedRowLimit
  return {
    metric: 'landing-page-visits',
    rows: [...visitsByPath.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, visits]) => ({ path, visits })),
    returnedRows: items.length,
    retainedRowLimit,
    retainedRowLimitReached,
    dataStatus: retainedRowLimitReached ? 'partial' : 'complete',
    qualityWarnings: retainedRowLimitReached
      ? [
          'Clicky returned the retained landing-page limit. Missing pages are not reliable zero-visit evidence.',
        ]
      : [],
  }
}

const activate: SeoProviderActivate = (host) => {
  host.registerProvider({
    id: 'clicky',
    displayName: 'Clicky',
    description:
      'Add traffic evidence and bounded analytics reports from Clicky.',
    kinds: ['traffic-analytics'],
    connection: {
      fields: [
        {
          id: 'siteId',
          label: 'Site ID',
          kind: 'account',
          required: true,
        },
        {
          id: 'sitekey',
          label: 'Sitekey',
          kind: 'secret',
          required: true,
          envVar: 'SEO_CLICKY_SITEKEY',
        },
      ],
      normalizeAccount: (account) => ({
        siteId: siteId(account.siteId ?? ''),
      }),
      verify,
    },
    capabilities: [{ id: 'landing-page-visits', run: landingPages }],
    actions: [
      {
        id: 'report',
        description: 'Run a bounded Clicky analytics report.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', default: 'pages-entrance' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: CLICKY_MAX_ROWS },
            page: { type: 'integer', minimum: 1 },
          },
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            siteId: { type: 'string' },
            type: { type: 'string' },
            range: {
              type: 'object',
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
              },
              required: ['startDate', 'endDate'],
            },
            rows: { type: 'array', items: { type: 'object' } },
            returnedRows: { type: 'integer', minimum: 0 },
            retainedRowLimit: { type: 'integer', minimum: 1 },
            retainedRowLimitReached: { type: 'boolean' },
          },
          required: [
            'siteId',
            'type',
            'rows',
            'returnedRows',
            'retainedRowLimit',
            'retainedRowLimitReached',
          ],
        },
        cacheTtlMs: CLICKY_CACHE_TTL_MS,
        run: nativeReport,
      },
    ],
  })
}

export default activate
