import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  SeoLandingPageVisitsCapability,
  SeoProviderActionAdapter,
  SeoProviderRegistration,
  SeoProviderRuntime,
} from 'seo/provider-sdk'
import activate from './index.js'

const account = { siteId: '123' }
const credentials = { sitekey: 'abc123abc123' }

async function clickyProvider(): Promise<SeoProviderRegistration> {
  let registration: SeoProviderRegistration | undefined
  await activate({
    apiVersion: 1,
    registerProvider(provider) {
      registration = provider
    },
  })
  if (!registration) throw new Error('Clicky did not register.')
  return registration
}

async function landingPages(): Promise<SeoLandingPageVisitsCapability> {
  const provider = await clickyProvider()
  const capability = provider.capabilities.find(
    (item) => item.id === 'landing-page-visits',
  )
  if (capability?.id !== 'landing-page-visits') {
    throw new Error('Landing-page visits capability was not registered.')
  }
  return capability
}

async function reportAction(): Promise<SeoProviderActionAdapter> {
  const provider = await clickyProvider()
  const action = provider.actions?.find((item) => item.id === 'report')
  if (!action) throw new Error('Clicky report action was not registered.')
  return action
}

function runtime(
  requestJson: SeoProviderRuntime['requestJson'],
): SeoProviderRuntime {
  return {
    now: () => '2026-08-07T00:00:00.000Z',
    requestJson,
  }
}

type LegacyClickyRow = {
  value?: string | number
  url?: string
}

// Frozen from the built-in Clicky landing-page conversion at origin/main.
function legacyLandingPageRows(
  rows: readonly LegacyClickyRow[],
): Array<{ path: string; visits: number }> {
  const values = new Map<string, number>()
  const orderedRows = [...rows].sort((left, right) =>
    (left.url ?? '') < (right.url ?? '')
      ? -1
      : (left.url ?? '') > (right.url ?? '')
        ? 1
        : 0,
  )
  for (const row of orderedRows) {
    if (!row.url) continue
    let path = ''
    try {
      path = new URL(row.url).pathname.replace(/\/$/u, '') || '/'
    } catch {
      continue
    }
    const visits = Number(row.value)
    if (!path || !Number.isSafeInteger(visits) || visits < 0) continue
    values.set(path, (values.get(path) ?? 0) + visits)
  }
  return [...values.entries()].map(([path, visits]) => ({ path, visits }))
}

test('Clicky registers legacy landing-page evidence and its native report', async () => {
  const provider = await clickyProvider()
  assert.equal(provider.id, 'clicky')
  assert.deepEqual(
    provider.capabilities.map((capability) => capability.id),
    ['landing-page-visits'],
  )
  assert.deepEqual(
    provider.actions?.map((action) => action.id),
    ['report'],
  )
})

test('Clicky native report matches the legacy raw report result and paging', async () => {
  const action = await reportAction()
  const urls: URL[] = []
  const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
    value: index,
    title: `Page ${index}`,
    url: `https://example.com/${index}`,
  }))
  const secondPage = [
    { value: 4, title: 'Last', url: 'https://example.com/last' },
  ]
  const result = await action.run(
    {
      account,
      credentials,
      params: {
        type: 'pages',
        startDate: '2026-07-01',
        endDate: '2026-07-28',
        limit: 1_500,
        page: 3,
      },
    },
    runtime(async (request) => {
      const url = new URL(request.url)
      urls.push(url)
      return [
        {
          type: 'pages',
          dates: [
            {
              items:
                url.searchParams.get('page') === '3' ? firstPage : secondPage,
            },
          ],
        },
      ]
    }),
  )

  assert.deepEqual(result, {
    siteId: '123',
    type: 'pages',
    range: { startDate: '2026-07-01', endDate: '2026-07-28' },
    rows: [...firstPage, ...secondPage],
    returnedRows: 1_001,
    retainedRowLimit: 1_500,
    retainedRowLimitReached: false,
  })
  assert.deepEqual(
    urls.map((url) => ({
      page: url.searchParams.get('page'),
      limit: url.searchParams.get('limit'),
      type: url.searchParams.get('type'),
      date: url.searchParams.get('date'),
    })),
    [
      {
        page: '3',
        limit: '1000',
        type: 'pages',
        date: '2026-07-01,2026-07-28',
      },
      { page: '4', limit: '500', type: 'pages', date: '2026-07-01,2026-07-28' },
    ],
  )
})

test('Clicky native report keeps optional dates and legacy input bounds', async () => {
  const action = await reportAction()
  let calls = 0
  const result = await action.run(
    {
      account,
      credentials,
      params: { type: 'visitors', limit: 1 },
    },
    runtime(async (request) => {
      calls += 1
      assert.equal(new URL(request.url).searchParams.has('date'), false)
      return []
    }),
  )
  assert.deepEqual(result, {
    siteId: '123',
    type: 'visitors',
    rows: [],
    returnedRows: 0,
    retainedRowLimit: 1,
    retainedRowLimitReached: false,
  })
  assert.equal(calls, 1)

  const invalidParams: Array<Record<string, string | number | boolean | null>> =
    [
      { type: 'Bad type', limit: 1 },
      { type: 'visitors', limit: 0 },
      { type: 'visitors', page: -1 },
      { type: 'visitors', startDate: '2026-08-01' },
    ]
  for (const params of invalidParams) {
    await assert.rejects(
      action.run(
        { account, credentials, params },
        runtime(async () => {
          throw new Error('Network must not run.')
        }),
      ),
      /Clicky/u,
    )
  }
})

test('Clicky matches legacy paging, requests, and landing-page values', async () => {
  const capability = await landingPages()
  const urls: URL[] = []
  const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
    value: '1',
    url: `https://example.com/pricing/?row=${index}`,
  }))
  const secondPage: LegacyClickyRow[] = [
    { value: 5, url: 'https://example.com/about' },
    { value: 'not-a-number', url: 'https://example.com/ignored' },
    { value: -1, url: 'https://example.com/negative' },
    { value: 2, url: 'not a URL' },
    { value: 3 },
  ]
  const result = await capability.run(
    {
      account,
      credentials,
      startDate: '2026-07-01',
      endDate: '2026-07-28',
      limit: 1_500,
    },
    runtime(async (request) => {
      const url = new URL(request.url)
      urls.push(url)
      const rows = url.searchParams.get('page') === '1' ? firstPage : secondPage
      return [
        {
          type: 'pages-entrance',
          dates: [{ date: '2026-07-01,2026-07-28', items: rows }],
        },
      ]
    }),
  )

  assert.deepEqual(
    result.rows,
    legacyLandingPageRows([...firstPage, ...secondPage]),
  )
  assert.equal(result.returnedRows, 1_005)
  assert.equal(result.retainedRowLimit, 1_500)
  assert.equal(result.retainedRowLimitReached, false)
  assert.equal(result.dataStatus, 'complete')
  assert.deepEqual(result.qualityWarnings, [])
  assert.equal(urls.length, 2)
  assert.deepEqual(
    urls.map((url) => Object.fromEntries(url.searchParams)),
    [
      {
        site_id: '123',
        sitekey: 'abc123abc123',
        type: 'pages-entrance',
        output: 'json',
        limit: '1000',
        page: '1',
        app: 'seo',
        date: '2026-07-01,2026-07-28',
      },
      {
        site_id: '123',
        sitekey: 'abc123abc123',
        type: 'pages-entrance',
        output: 'json',
        limit: '500',
        page: '2',
        app: 'seo',
        date: '2026-07-01,2026-07-28',
      },
    ],
  )
})

test('Clicky matches the legacy retained-row status', async () => {
  const capability = await landingPages()
  const result = await capability.run(
    {
      account,
      credentials,
      startDate: '2026-08-01',
      endDate: '2026-08-07',
      limit: 2,
    },
    runtime(async () => [
      {
        type: 'pages-entrance',
        dates: [
          {
            items: [
              { url: 'https://example.com/a', value: 1 },
              { url: 'https://example.com/b', value: 0 },
            ],
          },
        ],
      },
    ]),
  )

  assert.equal(result.returnedRows, 2)
  assert.equal(result.retainedRowLimitReached, true)
  assert.equal(result.dataStatus, 'partial')
  assert.equal(result.qualityWarnings.length, 1)
  assert.deepEqual(result.rows, [
    { path: '/a', visits: 1 },
    { path: '/b', visits: 0 },
  ])
})

test('Clicky matches legacy account and sitekey bounds', async () => {
  const provider = await clickyProvider()
  const thirtyDigitSiteId = '123456789012345678901234567890'
  assert.deepEqual(
    provider.connection.normalizeAccount?.({
      siteId: ` ${thirtyDigitSiteId} `,
    }),
    { siteId: thirtyDigitSiteId },
  )
  assert.throws(
    () =>
      provider.connection.normalizeAccount?.({
        siteId: `${thirtyDigitSiteId}1`,
      }),
    /numeric site ID/u,
  )

  let calls = 0
  await provider.connection.verify(
    {
      account: { siteId: thirtyDigitSiteId },
      credentials: { sitekey: 'aaaaaaaaaaaa' },
    },
    runtime(async () => {
      calls += 1
      return []
    }),
  )
  assert.equal(calls, 1)

  for (const invalidSitekey of ['short', 'abc123abc12_', 'a'.repeat(65)]) {
    await assert.rejects(
      provider.connection.verify(
        {
          account,
          credentials: { sitekey: invalidSitekey },
        },
        runtime(async () => {
          throw new Error('Network must not run.')
        }),
      ),
      /valid sitekey/u,
    )
  }
})

test('Clicky rejects legacy-invalid limits and dates before acquisition', async () => {
  const capability = await landingPages()
  let calls = 0
  const noNetwork = runtime(async () => {
    calls += 1
    return []
  })

  for (const limit of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      capability.run(
        {
          account,
          credentials,
          startDate: '2026-08-01',
          endDate: '2026-08-07',
          limit,
        },
        noNetwork,
      ),
      /positive whole number/u,
    )
  }
  await assert.rejects(
    capability.run(
      {
        account,
        credentials,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        limit: 100,
      },
      noNetwork,
    ),
    /31 days/u,
  )
  assert.equal(calls, 0)
})

test('Clicky rejects response shapes rejected by the legacy schema', async () => {
  const capability = await landingPages()
  const invalidResponses: unknown[] = [
    {},
    [null],
    [{ type: 1 }],
    [{ type: 'pages-entrance', dates: {} }],
    [{ type: 'pages-entrance', dates: [{ date: 1 }] }],
    [{ type: 'pages-entrance', dates: [{ items: [null] }] }],
    [
      {
        type: 'pages-entrance',
        dates: [{ items: [{ value: true, url: 'https://example.com/' }] }],
      },
    ],
    [
      {
        type: 'pages-entrance',
        dates: [
          { items: [{ url: `https://example.com/${'a'.repeat(4_096)}` }] },
        ],
      },
    ],
  ]

  for (const response of invalidResponses) {
    await assert.rejects(
      capability.run(
        {
          account,
          credentials,
          startDate: '2026-08-01',
          endDate: '2026-08-07',
          limit: 100,
        },
        runtime(async () => response),
      ),
      /invalid data/u,
    )
  }
})

test('Clicky keeps legacy authentication error classification', async () => {
  const provider = await clickyProvider()
  await assert.rejects(
    provider.connection.verify(
      { account, credentials },
      runtime(async () => [{ error: 'Invalid sitekey.' }]),
    ),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'authentication')
      assert.match(error.message, /rejected the configured site ID or sitekey/u)
      assert.doesNotMatch(error.message, /abc123abc123/u)
      return true
    },
  )
})
