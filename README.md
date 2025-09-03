# LAOS Rate‑Quoter Agent & Plugin

Production‑ready logistics rate quoting, scoring, and tendering built on ElizaOS. This project ships a specialized agent configuration plus a modular `@elizaos/plugin-rate-quoter` that provides rate retrieval and scoring over contract‑rate data.

## How the Agent and Plugins Interact

- The project defines a `ProjectAgent` in `src/index.ts` that loads the `rateQuoterPlugin` alongside the default character.
- The character (see `rate-quoter.json`) declares top‑level plugins like `@elizaos/plugin-sql` (database access) and `@elizaos/plugin-rate-quoter` (this plugin).
- Actions exposed by the plugin are invoked by the agent when the LLM decides to call them. Actions use services registered on the runtime.
- `RateQuoterService` is registered by the plugin and accessed within actions via `runtime.getService(RateQuoterService.serviceType)`.

Key entry points:
- `src/index.ts` – wires `rateQuoterPlugin` into the agent
- `src/plugins/rate-quoter/index.ts` – plugin metadata, config validation, actions/services
- `src/plugins/rate-quoter/services/rateQuoterService.ts` – service API for rates and scoring

## Plugin: @elizaos/plugin-rate-quoter

Plugin metadata: `src/plugins/rate-quoter/index.ts`

- Config (validated with zod):
  - `RATE_LIMIT_PER_MINUTE` (default 120)
  - `MAX_CONCURRENT_REQUESTS` (default 8)
  - `CACHE_TTL_SECONDS` (default 300)
  - `SCORING_WEIGHTS_COST` (default 0.35)
  - `SCORING_WEIGHTS_TIME` (default 0.25)
  - `SCORING_WEIGHTS_RELIABILITY` (default 0.30)
  - `SCORING_WEIGHTS_RISK` (default 0.10)
  - `SURCHARGES_ENABLED` (default true)

### Actions (current)

All actions return `{ success, text, values, data }` and perform input validation with zod inside their handlers.

1) `get_rates`
- Purpose: Fetch contract rates from SQL by lane and optional mode.
- Inputs (from `state.values`): `origin: string`, `destination: string`, `weightLbs: number`, `mode?: parcel|LTL|FTL|air|ocean`.
- Output `data`: `{ actionName: 'GET_RATES', quotes: Quote[], input: GetRatesInput }`.

2) `score_quotes`
- Purpose: Score quotes using a composite methodology (cost/time/reliability/risk) and return top results.
- Inputs: `{ weightLbs: number, quotes: Quote[], policy?: { weights?: { cost,time,reliability,risk }, maxTransitDays?, preferredCarriers? } }`.
- Output `data`: `{ actionName: 'SCORE_QUOTES', top3: ScoredQuote[], policy }`.

3) `get_top3_rates`
- Purpose: Convenience orchestration: fetch contract rates and return the top 3 by cost for the given weight.
- Inputs: `origin`, `destination`, `weightLbs`, `mode?`.
- Output `data`: `{ top3: ScoredQuote[] }`.

Planned (per architecture rules): `collect_requirements`, `tender_load` will round out the full flow. See Roadmap.

### Services (current)

`RateQuoterService` (`src/plugins/rate-quoter/services/rateQuoterService.ts`)
- `fetchContractRates(input: GetRatesInput): Promise<Quote[]>`
  - Queries SQL via `runtime.databaseAdapter.db` and maps Neon‑style rows into typed `Quote` objects.
- `scoreQuotesByWeight(quotes: Quote[], weightLbs: number): ScoredQuote[]`
  - Cost‑centric score used by `get_top3_rates`.
- `scoreQuotesComposite(quotes: Quote[], weightLbs: number, policy?: Partial<ScoringPolicy>): ScoredQuote[]`
  - Composite scoring with weights (cost/time/reliability/risk), tie‑broken deterministically.

Implementation notes:
- Database is accessed through the runtime adapter (`runtime.databaseAdapter.db`).
- Pricing considers `chargeBasis`, `fuelPct`, optional generic surcharges when `SURCHARGES_ENABLED=true`.
- Scoring weights can be supplied at runtime or defaulted from env.

### Providers and Evaluators

- Providers (planned): `shipmentContextProvider`, `carrierCatalogProvider`, `policyContextProvider`.
  - These will expose durable context to the LLM and are designed to be dynamic and fail‑soft.
- Evaluators (planned): `quoteQualityEvaluator`, `slaComplianceEvaluator`, `emissionsReasonablenessEvaluator`.
  - Deterministic checks that return structured results to inform ranking or guardrails.

Currently, `plugin.providers` and `plugin.evaluators` are empty; actions and services are live.

## Types

Defined in `src/plugins/rate-quoter/types/index.ts`:
- `Mode` = `'parcel' | 'LTL' | 'FTL' | 'air' | 'ocean'`
- `ShipmentSpec` = `{ origin, destination, weightLbs, mode? }`
- `Quote` = `{ carrierId, carrierName?, mode, origin, destination, minWeightLbs?, maxWeightLbs?, components: { baseRate, ratePerLb }, transitDays?, chargeBasis?, fuelPct?, currency? }`
- `ScoreBreakdown` with `totalCostUsd`, `costPerLbUsd`, optional factor scores and weights
- `ScoredQuote` extends `Quote` with `score` and `breakdown`
- `GetRatesInput`, `ScoringPolicy`, `ScoringPolicyWeights`, `ChargeBasis`

## Database & Schema

- Connection: set `POSTGRES_URL` in your environment (Neon/Postgres). The SQL layer is accessed via `@elizaos/plugin-sql` and the runtime adapter.
- Drizzle models live in `src/plugins/rate-quoter/drizzle/schema.ts` and include enums and tables for `carriers`, `rates`, and `surcharges`.
- `fetchContractRates` expects tables shaped similarly to `rates` and `carriers` with columns for lane, mode, validity window, base rate, charge basis, and fuel.

Helpful scripts:
- `scripts/neon-smoke.ts` – quick connectivity and minimal query check
- `scripts/seed-surcharges.ts` – seed common surcharge rows

## Configuration

Plugin config via env (parsed in `src/plugins/rate-quoter/index.ts`):
- `RATE_LIMIT_PER_MINUTE`, `MAX_CONCURRENT_REQUESTS`, `CACHE_TTL_SECONDS`
- `SCORING_WEIGHTS_COST`, `SCORING_WEIGHTS_TIME`, `SCORING_WEIGHTS_RELIABILITY`, `SCORING_WEIGHTS_RISK`
- `SURCHARGES_ENABLED` (true/false)

Agent config: `rate-quoter.json`
- Declares plugins (`@elizaos/plugin-sql`, `@elizaos/plugin-rate-quoter`, model, avatar, etc.).
- Default model is `gpt-4o-mini`; you can swap to Ollama by adding `@elizaos/plugin-ollama` and configuring `OLLAMA_API_ENDPOINT`.

## Quick Start

1) Configure environment

```bash
export POSTGRES_URL="postgres://USER:PASS@HOST:PORT/DB"  # Neon or Postgres
export OPENAI_API_KEY="..."                              # if using OpenAI
```

2) Run the agent

```bash
bun install
bun run build
elizaos dev
```

3) Ask for rates (examples the LLM will route to actions)

```
"Get rates from Ningbo to Hamburg for 2,000 lbs ocean"
→ calls get_rates → returns quotes

"Score these quotes for 2,000 lbs and show top options"
→ calls score_quotes → returns ranked top 3

"Just give me the top 3 now for LA → NYC at 500 lbs"
→ calls get_top3_rates → fetch + score
```

## Testing

Run component tests with Bun:

```bash
bun test
```

Relevant suites:
- `src/__tests__/rate-quoter.actions.test.ts`
- `src/__tests__/rate-quoter.service.test.ts`
- `src/__tests__/rate-quoter.plugin.test.ts`

## Roadmap

- Actions: `collect_requirements` (normalize to `ShipmentSpec`), `tender_load` (idempotent carrier tendering)
- Providers: shipment, carrier catalog, policy context
- Evaluators: quote quality, SLA compliance, emissions reasonableness
- Spot‑rate fetch via HTTP tools, FX and emissions estimators, durable audit trails

## Repository Map

- `src/index.ts` – project agent exports and plugin wiring
- `src/character.ts` – default character and platform plugins
- `src/plugins/rate-quoter/` – rate‑quoter plugin (actions, service, types, schema)
- `rate-quoter.json` – example agent configuration for the rate‑quoter persona

