# LP Range Chart Overlay Research

Date: 2026-05-10

Question: can the Aerodrome LP dashboard display managed CL position ranges directly on a price chart, similar to Orca, using GeckoTerminal or another easy integration?

## Short answer

Yes. The easiest high-quality path is:

1. Use the current repo dashboard for on-chain position/range state.
2. Add a custom candle chart with `lightweight-charts`.
3. Pull historical OHLCV from GeckoTerminal's public REST endpoint for the Aerodrome pool.
4. Draw our LP range overlays ourselves from `tickLower`, `tickUpper`, and `slot0.tick`.
5. Optionally add a GeckoTerminal iframe as a secondary "external chart" panel, but not as the primary Orca-style overlay.

Do not rely on a GeckoTerminal iframe for LP range overlays. The iframe is fast to embed, but we cannot reliably draw our own range bands inside the cross-origin chart.

## What Orca does well

Orca's Liquidity Terminal combines:

- a price chart beside the LP management controls
- live pool stats such as current price, TVL, 24h volume, and 24h fees
- controls for timeframes, indicators, aggregate pricing, liquidity depth, and average entry price
- position, history, closed-position, and simulator tabs

Their range model is the same core UX need here: an LP chooses lower and upper bounds, the position earns only while price stays inside that range, and the UI needs to make out-of-range risk obvious.

Relevant sources:

- Orca Liquidity Terminal overview: https://docs.orca.so/liquidity/terminal/overview
- Orca range concept docs: https://docs.orca.so/liquidity/concepts/liquidity-ranges

## GeckoTerminal options

### Option A: iframe embed

GeckoTerminal supports embedded DEX charts. Their embed examples are simple iframe URLs with query params like `embed=1`, `info=0`, `swaps=0`, chart type, resolution, and theme colors.

For this pool, the likely iframe shape is:

```html
<iframe
  title="GeckoTerminal LFI/USDC"
  src="https://www.geckoterminal.com/base/pools/0x8343c68279587498526114e6385f0a87f248e0d9?embed=1&info=0&swaps=0&light_chart=0&chart_type=price&resolution=15m"
  frameborder="0"
  allow="clipboard-write"
  allowfullscreen
></iframe>
```

Pros:

- fastest way to show a live professional chart
- minimal code
- GeckoTerminal handles candles, interactions, and refresh

Cons:

- cannot safely draw our own LP range rectangles inside the iframe
- styling and controls are externally owned
- not ideal for Hermes-specific range, staked-state, and history overlays

Sources:

- GeckoTerminal embed support note: https://support.coingecko.com/hc/en-us/articles/40147025457945-How-to-embed-GeckoTerminal-Charts-on-my-website
- GeckoTerminal embed guide: https://about.geckoterminal.com/embed-charts

### Option B: GeckoTerminal REST OHLCV + custom chart

GeckoTerminal exposes OHLCV data by network and pool:

```text
https://api.geckoterminal.com/api/v2/networks/base/pools/0x8343c68279587498526114e6385f0a87f248e0d9/ohlcv/minute?aggregate=15
```

Use this data to render candles locally, then overlay:

- horizontal lower range line
- horizontal upper range line
- translucent active range band
- current price/tick marker
- out-of-range shaded warning zones
- historical position spans from `positionHistory`

Pros:

- supports true Orca-style LP range overlays
- fully controlled visual language
- no cross-origin iframe limitations
- easy to connect with existing `rangeStatus`, `tickToAdjustedPrice`, and Hermes fixtures

Cons:

- public GeckoTerminal API rate limit is 30 calls/minute
- REST OHLCV is not tick-by-tick realtime
- WebSocket OHLCV appears to be Pro/API-key oriented for production realtime usage

Sources:

- GeckoTerminal REST OHLCV article: https://www.coingecko.com/learn/dex-data-api
- GeckoTerminal API FAQ and rate limit: https://apiguide.geckoterminal.com/faq
- CoinGecko OnchainOHLCV WebSocket docs: https://docs.coingecko.com/websocket/wssonchainohlcv

## Chart library recommendation

Use TradingView `lightweight-charts`, not an iframe, for the primary LP range chart.

Why:

- it is already designed for financial candles
- it supports custom overlays and price scales
- the repo is a Vite TypeScript app, so integration is straightforward
- it keeps Hermes range visuals under our control

TradingView docs note that price scales map prices to chart coordinates and can support overlay series without affecting the main scale.

Source:

- Lightweight Charts price scale docs: https://tradingview.github.io/lightweight-charts/docs/next/price-scale

## Integration plan for this repo

The parallel dashboard already added:

- live Base RPC reads
- current tick and tick-to-price math
- range status cards
- global tick map
- LP history surface

Recommended next implementation slice:

1. Add `lightweight-charts` dependency.
2. Add `src/gecko.ts` to fetch OHLCV from GeckoTerminal with a small cache and timeout.
3. Add `src/lp-range-chart.ts` to render candles and range overlays.
4. Convert LP range ticks to USDC/LFI price with existing `tickToAdjustedPrice`.
5. Render each active position as a price band from lower-price to upper-price.
6. Add a current price line from `slot0.tick`.
7. Add a fallback state: if GeckoTerminal fails or rate-limits, keep showing the existing tick map.
8. Add tests for GeckoTerminal response normalization and tick-to-band conversion.

Recommended refresh model:

- on-chain range status: keep current 15s refresh
- GeckoTerminal candles: 60s cache minimum for public API safety
- optional WebSocket later if using a CoinGecko Pro key

## Suggested data contract

```ts
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
};

type RangeOverlay = {
  tokenId: bigint;
  label: string;
  lowerTick: number;
  upperTick: number;
  lowerPrice: number;
  upperPrice: number;
  currentTick: number;
  inRange: boolean;
};
```

## Decision

Build the Orca-like view as a custom chart in this repo using GeckoTerminal OHLCV as the candle source. Add the GeckoTerminal iframe only as an optional external chart tab. This gives operators the useful part of Orca's terminal, while preserving Hermes-specific position history, gauge custody state, and post-rebalance audit details.
