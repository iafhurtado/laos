# Rate‑Quoter Plugin (Junior‑Friendly Guide)

This plugin helps an agent fetch shipping rate quotes from a database and score/rank them. Think of it as:

1) Read shipment basics (origin, destination, weight, optional mode)
2) Look up matching rates in a SQL table
3) Score those rates by estimated total cost
4) Return the best options for the user

This README explains what is implemented today and how pieces fit together.

---

## What’s implemented right now

- Actions
  - `get_rates`: fetches quotes from a SQL table for a given lane and optional mode
  - `score_quotes`: scores quotes (by cost) and returns the top ones
  - `get_top3_rates`: convenience action that fetches, scores, and shows the top 3
- Service
  - `RateQuoterService` with two key methods:
    - `fetchContractRates(input)` – runs a SQL query to get candidate quotes
    - `scoreQuotesByWeight(quotes, weightLbs)` – computes a simple, deterministic score
- Types are defined in `types/index.ts` (e.g., `Quote`, `ShipmentSpec`)

Not implemented yet (but planned in the architecture docs): `COLLECT_REQUIREMENTS` and `TENDER_LOAD` flows. Today we focus on fetching and scoring.

---

## Where the code lives

- Actions
  - `src/plugins/rate-quoter/actions/getRatesAction.ts`
  - `src/plugins/rate-quoter/actions/scoreQuotesAction.ts`
  - `src/plugins/rate-quoter/actions/getTop3RatesAction.ts`
- Service
  - `src/plugins/rate-quoter/services/rateQuoterService.ts`
- Plugin entry
  - `src/plugins/rate-quoter/index.ts` (wires service + actions)
- Types
  - `src/plugins/rate-quoter/types/index.ts`

---

## Data types (quick view)

From `types/index.ts`:

- `Mode`: `'parcel' | 'LTL' | 'FTL' | 'air' | 'ocean'`
- `ShipmentSpec`: `{ origin: string; destination: string; weightLbs: number; mode?: Mode }`
- `Quote`:
  - `carrierId`, optional `carrierName`
  - `mode`, `origin`, `destination`
  - `minWeightLbs?`, `maxWeightLbs?`
  - `components: { baseRate: number; ratePerLb: number }`
  - `transitDays?`
- `ScoredQuote` = `Quote` + `{ score: number; breakdown: { totalCostUsd, costPerLbUsd, weightFitPenalty } }`

---

## How actions and the service work together

High level:

- The agent calls an action. Actions validate inputs with `zod` and collect parameters from `state.values`.
- The action uses `RateQuoterService` to perform the heavy lifting (SQL lookup or scoring).
- The action returns `ActionResult` with a human‑readable `text` plus structured `data` (machine‑readable).

Flow diagram (simplified):

```
User input → state.values { origin, destination, weightLbs, mode? }
    │
    ├─ get_rates
    │   └─ RateQuoterService.fetchContractRates → quotes[]
    │
    ├─ score_quotes (requires quotes + weightLbs)
    │   └─ RateQuoterService.scoreQuotesByWeight → scored[] → top N
    │
    └─ get_top3_rates (convenience)
        ├─ fetchContractRates
        └─ scoreQuotesByWeight → top 3
```

### 1) `get_rates`

File: `actions/getRatesAction.ts`

- Expected inputs (read from `state.values`):
  - `origin: string`
  - `destination: string`
  - `weightLbs: number`
  - `mode?: 'parcel'|'LTL'|'FTL'|'air'|'ocean'` (optional; normalized from lowercase words)
- Validated with `zod` in the handler.
- Calls `service.fetchContractRates(input)`.
- Returns:
  - `text`: short summary (e.g., “Found 5 quotes for A → B”).
  - `data`: `{ quotes: Quote[] }`.

What the service does under the hood here:
- Uses the runtime database adapter: `runtime.databaseAdapter.db`.
- Runs a SQL query against a `rates` table, filtering by origin/destination and optional mode.
- Maps rows to `Quote` objects.

Minimal expected table shape (commented in code):

```
rates(
  origin text,
  destination text,
  mode text,
  carrier_id text,
  carrier_name text,
  min_weight_lbs numeric,
  max_weight_lbs numeric,
  base_rate numeric,
  rate_per_lb numeric,
  transit_days int
)
```

If no DB adapter is configured, the service logs a warning and returns an empty array.

### 2) `score_quotes`

File: `actions/scoreQuotesAction.ts`

- Inputs (validated by `zod`):
  - `weightLbs: number`
  - `quotes: Quote[]` (usually passed via `state.data` from a previous step)
- Calls `service.scoreQuotesByWeight(quotes, weightLbs)`.
- Returns top options (top 3 in the action) with `text` and `data: { top3 }`.

What the service scoring does:
- Computes `totalCost = baseRate + ratePerLb * weightLbs`.
- Computes `costPerLb = totalCost / weightLbs`.
- Applies a simple penalty if `weightLbs` is outside a quote’s min/max bracket (adds 15% to the score).
- Sorts ascending by `score` (lower is better – it’s cost‑centric).

### 3) `get_top3_rates`

File: `actions/getTop3RatesAction.ts`

- Convenience action: fetch rates and immediately score them.
- Inputs from `state.values`: same as `get_rates`.
- Calls `fetchContractRates` then `scoreQuotesByWeight`.
- Returns a human‑friendly list of the top 3, plus `data: { top3 }`.

---

## Where do inputs come from?

Actions read from `state.values`. Typical keys used today:
- `origin`
- `destination`
- `weightLbs`
- `mode` (optional; normalized to one of `Mode` values)

If you’re calling actions programmatically, you can set these on the state or pass them through earlier steps. In a chat flow, the agent or upstream provider usually extracts them from the user’s message.

Common gotchas:
- Make sure `weightLbs` is a number (the actions coerce strings with `Number(...)`, but validation expects a positive number).
- `mode` is optional; leave it off if you don’t want to filter.

---

## Service details (a bit deeper)

`RateQuoterService` lives in `services/rateQuoterService.ts` and extends the core `Service` class. Key methods:

- `fetchContractRates(input: GetRatesInput): Promise<Quote[]>`
  - Builds a safe SQL query against `rates`.
  - Uses `ILIKE` with `%origin%` / `%destination%` substring matches.
  - Returns mapped `Quote[]`.

- `scoreQuotesByWeight(quotes: Quote[], weightLbs: number): ScoredQuote[]`
  - Produces a `ScoredQuote[]` with a deterministic, cost‑based score.
  - Applies a 15% penalty when the weight is outside the min/max range.
  - Sorts ascending by score (best first).

Error handling is “fail soft”: logs and returns empty arrays on failures so the agent doesn’t crash.

---

## End‑to‑end example (mental model)

1) User provides: “Quote 500 lbs from Chicago to Dallas (LTL)”
2) `get_rates` reads `origin=Chicago`, `destination=Dallas`, `weightLbs=500`, `mode=LTL`
3) Service queries `rates` table, returns matching quotes
4) `score_quotes` or `get_top3_rates` sorts by total cost (with weight fit penalty) and shows top results

---

## Configuration & plugin wiring

- The plugin is declared in `src/plugins/rate-quoter/index.ts`.
- It registers the service and actions with the runtime.
- Config values like rate limits are validated with `zod` (see the plugin file).
- See `rate-quoter.json` at the repo root for an example agent configuration that enables this plugin.

---

## Extending from here (roadmap hints)

Architecture docs in this repo describe additional actions/providers (e.g., `COLLECT_REQUIREMENTS`, `TENDER_LOAD`, and provider‑based context). To add those:
- Add new actions under `actions/` (validate inputs with `zod`, return structured `ActionResult`).
- Expand `RateQuoterService` with methods like `fetchSpotRates`, `tenderLoad`, etc., with idempotency and retries.
- Introduce providers to surface `ShipmentSpec`, carrier catalogs, and scoring policies into `state.values`.

Keep changes small and testable. Start with unit tests for each action and service method.

---

## Troubleshooting tips

- Empty results? Ensure the database adapter is available and the `rates` table has rows matching your lane.
- Validation errors? Check that `origin`, `destination`, and a positive numeric `weightLbs` are being passed.
- Unexpected scoring? Remember the 15% penalty when outside `minWeightLbs`/`maxWeightLbs`.

---

## TL;DR

- Actions do input handling and presentation; the service does the heavy lifting.
- `get_rates` → reads inputs → service SQL lookup → quotes
- `score_quotes`/`get_top3_rates` → service scoring → best options
- Types in `types/index.ts` describe all shapes you’ll see in code.

Happy quoting!
