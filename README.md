<h1 align="center">Clicky provider for SEO Skill</h1>

<p align="center">
  Add Clicky landing-page visits to SEO reports and run Clicky analytics reports from the <code>seo</code> command.
</p>

<p align="center">
  <a href="#install-the-provider">Install</a>
  ·
  <a href="https://seoskill.dev/docs/clicky">Documentation</a>
  ·
  <a href="https://www.npmjs.com/package/@seoskill/clicky-provider">npm</a>
  ·
  <a href="https://github.com/iannuttall/seo">Main project</a>
  ·
  <a href="https://clicky.com/help/api">Clicky API</a>
  ·
  <a href="https://github.com/iannuttall/seoskill-clicky-provider/issues">Questions</a>
  ·
  <a href="SECURITY.md">Security</a>
  ·
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <a href="https://github.com/iannuttall/seoskill-clicky-provider/actions/workflows/ci.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/iannuttall/seoskill-clicky-provider/ci.yml?branch=main&label=checks&style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@seoskill/clicky-provider"><img alt="npm version" src="https://img.shields.io/npm/v/@seoskill/clicky-provider?style=flat-square"></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/Node-22%2B-339933?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square">
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square"></a>
</p>

The package keeps the Clicky adapter outside the main `seo` package. The main package still owns installation, credentials, network limits, caching, project profiles, report logic, and evidence labels.

## What this package adds

| Part | What it does |
| --- | --- |
| Landing-page visits | Maps Clicky entrance-page visitors to the shared traffic evidence used by compatible reports. |
| Clicky reports | Keeps `seo analytics clicky report` available for Clicky-native report types. |
| Provider action | Lets agents inspect and run the Clicky report action through the CLI or MCP server. |
| Local connection | Stores the site ID as account data and keeps the sitekey in the managed secret store. |

This is a first-party provider package maintained by the same team as
[`seo`](https://github.com/iannuttall/seo). It uses the public provider SDK, so
its adapter, tests, and releases stay separate from the main package.

## Requirements

- Node.js 22.19 or newer
- `seo` 0.2.34 or newer
- A Clicky site ID
- The sitekey for that Clicky site

Install the main command first:

```sh
npm install --global seo
```

## Install the provider

Install this package by npm name. The command shows the exact version, publisher, repository, integrity, and local permission warning before it installs code.

```sh
seo providers install @seoskill/clicky-provider
```

For JSON or CI use, approve the exact package without a prompt:

```sh
seo providers install @seoskill/clicky-provider --yes --json
```

The provider loader only runs packages recorded in the local provider registry. It does not scan project or global `node_modules` directories.

## Connect Clicky

Connect the Clicky site ID and enter the sitekey when asked:

```sh
seo providers connect clicky --account '{"siteId":"123456789"}'
```

The site ID is saved as account data. The sitekey is stored in the managed secret store. On supported systems, this uses the operating system keychain. A private local credential file is the fallback.

Agents and CI can provide the sitekey through an environment variable:

```sh
export SEO_CLICKY_SITEKEY="your-sitekey"
seo providers connect clicky \
  --account '{"siteId":"123456789"}' \
  --json
```

Do not commit the sitekey or add it to a command argument.

Check the saved connection with one small Clicky request:

```sh
seo providers status clicky --check
```

## Add Clicky to a project

Run the guided setup after the provider is connected:

```sh
seo start
```

Choose Clicky as the optional traffic analytics source for the project. Existing Clicky project settings and saved sitekeys are reused when they are available.

Start with the main report:

```sh
seo report --project example
```

Clicky supplies landing page visits to compatible report sections. A report can join these visits to crawl pages by the retained landing page path.

## Run Clicky reports

The existing Clicky command remains available after this package is installed:

```sh
seo analytics clicky report \
  --project example \
  --start-date 2026-08-01 \
  --end-date 2026-08-07
```

Agents can inspect and run the package action through the provider interface:

```sh
seo providers describe clicky --json

seo providers run clicky report \
  --params '{"type":"pages-entrance","startDate":"2026-08-01","endDate":"2026-08-07","limit":1000}' \
  --json
```

The `report` action accepts these parameters:

| Parameter | Meaning |
| --- | --- |
| `type` | A Clicky report type. The default is `pages-entrance`. |
| `startDate` | First date in `YYYY-MM-DD` format. Use it with `endDate`. |
| `endDate` | Last date in `YYYY-MM-DD` format. The range can cover up to 31 days. |
| `limit` | Maximum retained rows. The package allows 1 to 5,000 rows. |
| `page` | First Clicky API page. The default is 1. |

The action result includes the report type, rows, retained limit, returned row count, and a flag that shows when the retained limit was reached. Action results use a 24 hour local cache unless you pass `--refresh`.

## What the evidence means

The shared capability maps Clicky's `pages-entrance` values to landing page visits. It does not create Google Analytics users, conversions, attribution, or geography fields.

The package rejects invalid provider responses before they become report evidence. It skips landing page rows that do not contain a valid URL and a whole, non-negative visit value. Duplicate paths are added together and the final paths use stable codepoint order.

When the retained row limit is reached, the result is marked as partial. A missing path in partial data is not evidence of zero visits.

## Limits and network access

- One API page requests at most 1,000 rows.
- One run retains at most 5,000 rows.
- One explicit date range covers at most 31 days.
- Requests go to `https://api.clicky.com/api/stats/4`.
- The site ID and sitekey are sent only to Clicky's API for the requested operation.

The main `seo` package applies its provider request and row limits before it runs this adapter. Inspect or change local limits with:

```sh
seo providers limits clicky
seo providers limits clicky --requests 10 --rows 5000
```

## Disconnect or remove the package

Remove the saved account and managed secret:

```sh
seo providers disconnect clicky
```

Environment variables remain under the control of your shell.

Remove the installed package from the local provider registry:

```sh
seo providers remove clicky
```

## Agent use

Agents should run `seo providers describe clicky --json` or `seo_describe_provider` before using a provider action. The response includes the input and output JSON schemas. Run the action with `seo providers run` or `seo_run_provider`. The main package validates both sides of the call and returns structured provider errors.

Use the shared landing page capability through normal reports when you need report evidence. Use the `report` action only when you need a Clicky native report that is not part of a shared report shape.

## Development

Clone the repository and run the full local checks:

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm pack --dry-run
```

The tests cover provider registration, legacy Clicky report parity, paging, date and input bounds, landing page mapping, partial data status, invalid responses, and authentication errors.

This package has no runtime dependency tree. It imports provider types from the public `seo/provider-sdk` entry point and bundles its adapter into one ESM entry file.

## Releases

The package is published as [`@seoskill/clicky-provider`](https://www.npmjs.com/package/@seoskill/clicky-provider). A version change in `package.json` on `main` starts the release workflow. GitHub Actions runs the checks, publishes with npm trusted publishing and provenance, then creates the matching `v<version>` Git tag.

## Security

Do not post sitekeys, Clicky responses, private URLs, or client data in a public issue. Use the [private security advisory form](https://github.com/iannuttall/seoskill-clicky-provider/security/advisories/new) for a suspected vulnerability.

## License

Apache-2.0. See [LICENSE](LICENSE).
