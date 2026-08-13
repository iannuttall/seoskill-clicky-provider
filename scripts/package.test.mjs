import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))

assert.equal(manifest.name, '@seoskill/clicky-provider')
assert.equal(manifest.type, 'module')
assert.equal(manifest.license, 'Apache-2.0')
assert.equal(manifest.seo?.apiVersion, 1)
assert.deepEqual(manifest.seo?.providers, ['./dist/index.js'])
assert.equal(manifest.dependencies, undefined)
assert.equal(manifest.optionalDependencies, undefined)
assert.equal(manifest.exports?.['.']?.import, './dist/index.js')
assert.equal(manifest.exports?.['.']?.types, './dist/index.d.ts')

await Promise.all([
  access('dist/index.js'),
  access('dist/index.d.ts'),
  access('README.md'),
  access('LICENSE'),
  access('SECURITY.md'),
])

const module = await import(new URL('../dist/index.js', import.meta.url))
assert.equal(typeof module.default, 'function')
