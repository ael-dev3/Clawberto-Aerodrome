import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import { tickLabel, tickToAdjustedPrice } from './aero-math';
import { fetchGeckoPoolOhlcv, type GeckoCandle } from './gecko';
import { buildRangeOverlays, formatChartPrice, type LpRangeOverlay } from './lp-range-overlays';
import type { DashboardSnapshot } from './rpc';

const CHART_HEIGHT = 340;
let activeChart: IChartApi | undefined;
let activeResizeObserver: ResizeObserver | undefined;
let activeRenderToken = 0;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function currentPrice(snapshot: DashboardSnapshot): number {
  return tickToAdjustedPrice(snapshot.pool.currentTick, 18, 6);
}

function chartHeight(chartNode: HTMLElement): number {
  return Math.max(300, Math.floor(chartNode.clientHeight || CHART_HEIGHT));
}

function toSeriesData(candles: GeckoCandle[]): CandlestickData<Time>[] {
  return candles.map((candle) => ({
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function edgeData(candles: GeckoCandle[], value: number): Array<{ time: UTCTimestamp; value: number }> {
  const first = candles.at(0);
  const last = candles.at(-1);
  if (!first || !last) return [];
  return [
    { time: first.time as UTCTimestamp, value },
    { time: last.time as UTCTimestamp, value },
  ];
}

function renderLoading(snapshot: DashboardSnapshot, overlays: LpRangeOverlay[]): string {
  return `
    <div class="chart-state">
      <div class="loader small"></div>
      <div>
        <strong>Loading GeckoTerminal candles</strong>
        <span>${overlays.length} LP ranges mapped against tick ${tickLabel(snapshot.pool.currentTick)}</span>
      </div>
    </div>
  `;
}

function renderLegend(snapshot: DashboardSnapshot, overlays: LpRangeOverlay[], source: string): string {
  const price = currentPrice(snapshot);
  return `
    <aside class="chart-side">
      <div class="chart-metric">
        <span>Current LFI price</span>
        <strong>$${formatChartPrice(price)}</strong>
        <small>Tick ${tickLabel(snapshot.pool.currentTick)}</small>
      </div>
      <div class="chart-source">${source}</div>
      <div class="chart-range-list">
        ${overlays.length === 0 ? `
          <div class="chart-empty-range">
            <strong>No active LP overlay</strong>
            <small>Price candles are live. Range bands appear automatically when a tracked wallet owns or stakes a readable LFI/USDC Slipstream NFT.</small>
          </div>
        ` : overlays.map((overlay) => `
          <div class="chart-range-row">
            <span class="range-swatch" style="--range-color: ${overlay.color}"></span>
            <div>
              <strong>NFT #${overlay.tokenId}</strong>
              <small>${escapeHtml(overlay.label)}</small>
              <small>${tickLabel(overlay.lowerTick)} to ${tickLabel(overlay.upperTick)}</small>
              <small>$${formatChartPrice(overlay.lowerPrice)} to $${formatChartPrice(overlay.upperPrice)}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </aside>
  `;
}

function renderFallback(snapshot: DashboardSnapshot, overlays: LpRangeOverlay[], error: unknown): string {
  return `
    <div class="chart-fallback">
      <div>
        <p class="eyebrow">Chart source unavailable</p>
        <h3>Live LP ranges are still online</h3>
        <p>${error instanceof Error ? escapeHtml(error.message) : escapeHtml(String(error))}</p>
      </div>
      ${renderLegend(snapshot, overlays, 'On-chain range state only')}
    </div>
  `;
}

function drawRangeBands(
  overlayNode: HTMLElement,
  series: ISeriesApi<'Candlestick'>,
  overlays: LpRangeOverlay[],
  chartHeight: number,
): void {
  overlayNode.innerHTML = overlays.map((overlay) => {
    const topPriceY = series.priceToCoordinate(overlay.upperPrice);
    const bottomPriceY = series.priceToCoordinate(overlay.lowerPrice);
    if (topPriceY === null || bottomPriceY === null) return '';

    const top = Math.max(0, Math.min(topPriceY, bottomPriceY));
    const bottom = Math.min(chartHeight, Math.max(topPriceY, bottomPriceY));
    const height = Math.max(10, bottom - top);

    return `
      <div class="chart-range-band ${overlay.status.state.toLowerCase().replaceAll('_', '-')}" style="--range-color: ${overlay.color}; top: ${top}px; height: ${height}px;">
        <span>#${overlay.tokenId} ${escapeHtml(overlay.label)}</span>
      </div>
    `;
  }).join('');
}

function resetChart(): void {
  activeResizeObserver?.disconnect();
  activeResizeObserver = undefined;
  activeChart?.remove();
  activeChart = undefined;
}

function renderChartFrame(snapshot: DashboardSnapshot, overlays: LpRangeOverlay[], candles: GeckoCandle[]): string {
  const first = new Date(candles[0].time * 1000).toLocaleString();
  const last = new Date(candles[candles.length - 1].time * 1000).toLocaleString();
  return `
    <div class="chart-layout">
      <div class="chart-viewport">
        <div class="chart-canvas" role="img" aria-label="LFI price candles with LP range bands"></div>
        <div class="chart-overlay" aria-hidden="true"></div>
      </div>
      ${renderLegend(snapshot, overlays, `${candles.length} 15m candles from GeckoTerminal, ${first} to ${last}`)}
    </div>
  `;
}

export async function renderLpRangeChart(snapshot: DashboardSnapshot, mount: HTMLElement): Promise<void> {
  resetChart();
  mount.classList.remove('compact-chart');
  const overlays = buildRangeOverlays(snapshot);
  const renderToken = ++activeRenderToken;
  mount.innerHTML = renderLoading(snapshot, overlays);

  try {
    const candles = await fetchGeckoPoolOhlcv();
    if (renderToken !== activeRenderToken || !mount.isConnected) return;

    mount.innerHTML = renderChartFrame(snapshot, overlays, candles);
    const chartNode = mount.querySelector<HTMLDivElement>('.chart-canvas');
    const overlayNode = mount.querySelector<HTMLDivElement>('.chart-overlay');
    if (!chartNode || !overlayNode) return;

    const width = Math.max(320, chartNode.clientWidth);
    const height = chartHeight(chartNode);
    const chart = createChart(chartNode, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' },
        textColor: '#a8a2bd',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.055)' },
        horzLines: { color: 'rgba(255,255,255,0.075)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(20,241,217,0.45)' },
        horzLine: { color: 'rgba(20,241,217,0.45)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 7,
      },
      localization: {
        priceFormatter: (price: number) => `$${formatChartPrice(price)}`,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    activeChart = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#16c784',
      downColor: '#ff5c7a',
      borderUpColor: '#16c784',
      borderDownColor: '#ff5c7a',
      wickUpColor: '#16c784',
      wickDownColor: '#ff5c7a',
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    candleSeries.setData(toSeriesData(candles));

    const price = currentPrice(snapshot);
    const currentLine = chart.addLineSeries({
      color: '#14f1d9',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: true,
      lastValueVisible: true,
      title: 'Current tick',
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    currentLine.setData(edgeData(candles, price));

    for (const overlay of overlays) {
      const lowerLine = chart.addLineSeries({
        color: overlay.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `#${overlay.tokenId} lower`,
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
      });
      lowerLine.setData(edgeData(candles, overlay.lowerPrice));

      const upperLine = chart.addLineSeries({
        color: overlay.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `#${overlay.tokenId} upper`,
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
      });
      upperLine.setData(edgeData(candles, overlay.upperPrice));
    }

    chart.timeScale().fitContent();
    const repaintBands = () => window.requestAnimationFrame(() => drawRangeBands(overlayNode, candleSeries, overlays, chartHeight(chartNode)));
    repaintBands();

    activeResizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width));
      chart.resize(nextWidth, chartHeight(chartNode));
      repaintBands();
    });
    activeResizeObserver.observe(chartNode);
  } catch (error) {
    if (renderToken === activeRenderToken && mount.isConnected) {
      mount.innerHTML = renderFallback(snapshot, overlays, error);
    }
  }
}
