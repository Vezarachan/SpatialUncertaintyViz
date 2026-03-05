// Map visualization with Deck.gl — 2 modes: Scatter, Halo Glyphs
import State from './state.js';

let map = null;
let deckOverlay = null;
let currentData = null;
let currentDataExtent = 100; // diagonal degrees of data extent
let mapLoaded = false;
let pendingResults = null;
let currentMapMode = 'scatter'; // 'scatter' | 'halo'

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [-98, 38],
        zoom: 4,
        antialias: true,
    });

    deckOverlay = new deck.MapboxOverlay({
        layers: [],
    });
    map.addControl(deckOverlay);
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Mark map as loaded and process pending results
    map.on('load', () => {
        console.log('[MapView] Map loaded');
        mapLoaded = true;
        if (pendingResults) {
            console.log('[MapView] Processing pending results');
            safeUpdateMap(pendingResults);
            pendingResults = null;
        }
    });

    // Listen for results
    State.on('results', (results) => {
        if (!results) return;
        if (mapLoaded) {
            safeUpdateMap(results);
        } else {
            console.log('[MapView] Map not loaded yet, queuing results');
            pendingResults = results;
        }
    });

    // Map mode change
    document.getElementById('map-mode').addEventListener('change', (e) => {
        currentMapMode = e.target.value;
        if (currentData) {
            try {
                const metric = document.getElementById('color-metric').value;
                updateLayers(currentData, metric);
            } catch (err) {
                console.error('[MapView] Mode switch error:', err);
            }
        }
    });

    // Color metric change
    document.getElementById('color-metric').addEventListener('change', (e) => {
        if (currentData) {
            try {
                updateLayers(currentData, e.target.value);
            } catch (err) {
                console.error('[MapView] Layer update error:', err);
            }
        }
    });
}

function safeUpdateMap(results) {
    try {
        updateMap(results);
        console.log('[MapView] Map updated successfully, points:', results.per_point?.coords_lonlat?.length);
    } catch (err) {
        console.error('[MapView] Map update error:', err);
    }
}

// ============================================================
// Safe min/max for large arrays (avoids spread operator stack overflow)
// Also skips NaN / Infinity
// ============================================================
function arrayMin(arr) {
    let min = Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (Number.isFinite(arr[i]) && arr[i] < min) min = arr[i];
    }
    return min;
}
function arrayMax(arr) {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (Number.isFinite(arr[i]) && arr[i] > max) max = arr[i];
    }
    return max;
}

// ============================================================
// Resolve metric values from per-point data
// ============================================================
function getMetricValues(pp, metric) {
    return pp[metric] || pp.uncertainty;
}

// ============================================================
// Update map: fit bounds + render layers
// ============================================================
function updateMap(results) {
    currentData = results;
    const coords = results.per_point?.coords_lonlat;

    if (!coords || coords.length === 0) {
        console.warn('No coords_lonlat in results');
        return;
    }

    // Fit bounds with smooth animation
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);

    const lngMin = arrayMin(lngs), lngMax = arrayMax(lngs);
    const latMin = arrayMin(lats), latMax = arrayMax(lats);

    // Compute data extent for adaptive point radius
    const lngSpan = Math.max(lngMax - lngMin, 0.01);
    const latSpan = Math.max(latMax - latMin, 0.01);
    const diagonalDeg = Math.sqrt(lngSpan * lngSpan + latSpan * latSpan);

    // Store extent for radius calculation
    currentDataExtent = diagonalDeg;

    // Add proportional padding (5% of span, at least 0.05°)
    const lngPad = Math.max(lngSpan * 0.05, 0.05);
    const latPad = Math.max(latSpan * 0.05, 0.05);

    const bounds = [
        [lngMin - lngPad, Math.max(latMin - latPad, -85)],
        [lngMax + lngPad, Math.min(latMax + latPad, 85)],
    ];
    try {
        map.fitBounds(bounds, {
            padding: { top: 60, bottom: 20, left: 20, right: 20 },
            animate: true,
            duration: 1200,
            essential: true,
        });
    } catch (err) {
        console.warn('fitBounds failed:', err.message);
    }

    const metric = document.getElementById('color-metric').value;
    updateLayers(results, metric);
}

// ============================================================
// Dispatch to the correct layer renderer
// ============================================================
function updateLayers(results, metric) {
    switch (currentMapMode) {
        case 'halo':
            updateHaloLayers(results);
            break;
        default:
            updateScatterLayers(results, metric);
    }
}

// ============================================================
// Mode 1: Scatter Plot (original)
// ============================================================
function updateScatterLayers(results, metric) {
    const pp = results.per_point;
    if (!pp) return;

    const values = getMetricValues(pp, metric);
    if (!values || values.length === 0) return;

    // Filter out NaN / Infinity for statistics
    const finiteValues = values.filter(v => Number.isFinite(v));
    if (finiteValues.length === 0) return;

    const vMin = arrayMin(finiteValues);
    const vMax = arrayMax(finiteValues);
    const range = vMax - vMin || 1;

    // Build data array, clamping NaN/Infinity to 0
    const data = pp.coords_lonlat.map((coord, i) => {
        const val = Number.isFinite(values[i]) ? values[i] : vMin;
        return {
            position: coord,
            index: i,
            value: val,
            normalizedValue: (val - vMin) / range,
            uncertainty: Number.isFinite(pp.uncertainty?.[i]) ? pp.uncertainty[i] : 0,
            predValue: pp.pred_value?.[i] ?? 0,
            trueValue: pp.true_value?.[i] ?? 0,
            covered: pp.covered?.[i] ?? false,
            residual: pp.residual?.[i] ?? 0,
            nEff: pp.n_eff?.[i] ?? null,
        };
    });

    // Adaptive radius: ~1/60 of data extent in meters
    // 1 degree ≈ 111 km → extent * 111000 / 60
    const adaptiveRadius = Math.max(500, Math.min(currentDataExtent * 111000 / 60, 10000));

    const scatterLayer = new deck.ScatterplotLayer({
        id: 'scatter',
        data,
        getPosition: d => d.position,
        getFillColor: d => valueToColor(d.normalizedValue, metric),
        getLineColor: [30, 30, 60, 160],
        stroked: true,
        lineWidthMinPixels: 1,
        getRadius: adaptiveRadius,
        radiusMinPixels: 4,
        radiusMaxPixels: 18,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 0, 180],
        onClick: (info) => {
            if (info.object) {
                State.setSelectedPoint(info.object.index);
            }
        },
        onHover: handlePointHover,
    });

    deckOverlay.setProps({ layers: [scatterLayer] });
    updateLegend(vMin, vMax, metric);
}

// ============================================================
// Mode 2: Adaptive Halo Glyphs
//   - Color = predicted value
//   - Halo radius = prediction interval width
// ============================================================
function updateHaloLayers(results) {
    const pp = results.per_point;
    if (!pp) return;

    const coords = pp.coords_lonlat;
    const predValues = pp.pred_value || [];
    const uncValues = pp.uncertainty || [];

    const finPred = predValues.filter(v => Number.isFinite(v));
    const finUnc = uncValues.filter(v => Number.isFinite(v));
    if (finPred.length === 0 || finUnc.length === 0) return;

    const predMin = arrayMin(finPred), predMax = arrayMax(finPred);
    const predRange = predMax - predMin || 1;
    const uncMin = arrayMin(finUnc), uncMax = arrayMax(finUnc);
    const uncRange = uncMax - uncMin || 1;

    const data = coords.map((coord, i) => ({
        position: coord,
        index: i,
        predValue: predValues[i] || 0,
        normalizedPred: (((predValues[i] || 0) - predMin) / predRange),
        uncertainty: uncValues[i] || 0,
        normalizedUnc: (((uncValues[i] || 0) - uncMin) / uncRange),
        trueValue: pp.true_value?.[i] ?? 0,
        covered: pp.covered?.[i] ?? false,
        residual: pp.residual?.[i] ?? 0,
        nEff: pp.n_eff?.[i] ?? null,
    }));

    // Adaptive radii based on data extent and point count
    const N = data.length;
    const maxHaloRadius = Math.max(800, currentDataExtent * 111000 / Math.max(40, Math.sqrt(N) * 1.5));
    const minHaloRadius = maxHaloRadius * 0.15;

    // Layer 1: Outer glow — semi-transparent, proportional to uncertainty
    const outerGlow = new deck.ScatterplotLayer({
        id: 'halo-outer',
        data,
        getPosition: d => d.position,
        getFillColor: d => {
            const c = valueToColor(d.normalizedPred, 'sequential');
            return [c[0], c[1], c[2], 70];
        },
        getRadius: d => minHaloRadius + d.normalizedUnc * (maxHaloRadius - minHaloRadius),
        radiusMinPixels: 6,
        radiusMaxPixels: 35,
        pickable: false,
    });

    // Layer 2: Inner glow — more opaque, 55% of outer radius
    const innerGlow = new deck.ScatterplotLayer({
        id: 'halo-inner',
        data,
        getPosition: d => d.position,
        getFillColor: d => {
            const c = valueToColor(d.normalizedPred, 'sequential');
            return [c[0], c[1], c[2], 130];
        },
        getRadius: d => (minHaloRadius + d.normalizedUnc * (maxHaloRadius - minHaloRadius)) * 0.55,
        radiusMinPixels: 4,
        radiusMaxPixels: 20,
        pickable: false,
    });

    // Layer 3: Center dot — opaque, colored by predicted value
    const centerRadius = Math.max(80, currentDataExtent * 111000 / Math.max(200, Math.sqrt(N) * 6));
    const centerDot = new deck.ScatterplotLayer({
        id: 'halo-center',
        data,
        getPosition: d => d.position,
        getFillColor: d => valueToColor(d.normalizedPred, 'sequential'),
        getLineColor: [40, 40, 70, 200],
        stroked: true,
        lineWidthMinPixels: 1,
        getRadius: centerRadius,
        radiusMinPixels: 2,
        radiusMaxPixels: 6,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 0, 180],
        onClick: (info) => {
            if (info.object) State.setSelectedPoint(info.object.index);
        },
        onHover: handlePointHover,
    });

    deckOverlay.setProps({ layers: [outerGlow, innerGlow, centerDot] });
    updateHaloLegend(predMin, predMax, uncMin, uncMax);
}

// ============================================================
// Shared hover handler for data points
// ============================================================
function handlePointHover(info) {
    const tooltip = document.getElementById('tooltip');
    if (info.object) {
        const d = info.object;
        let html = `<strong>Point #${d.index}</strong><br>`;
        html += `True: ${d.trueValue.toFixed(3)}<br>`;
        html += `Predicted: ${d.predValue.toFixed(3)}<br>`;
        html += `Uncertainty: ${d.uncertainty.toFixed(3)}<br>`;
        html += `Covered: ${d.covered ? 'Yes' : 'No'}<br>`;
        html += `Residual: ${d.residual.toFixed(3)}`;
        if (d.nEff !== null) html += `<br>N_eff: ${d.nEff.toFixed(1)}`;
        tooltip.innerHTML = html;
        tooltip.style.left = info.x + 10 + 'px';
        tooltip.style.top = info.y + 10 + 'px';
        tooltip.classList.remove('hidden');
    } else {
        tooltip.classList.add('hidden');
    }
}

// ============================================================
// Color Mapping
// ============================================================
function valueToColor(t, metric) {
    // t is 0-1 normalized; clamp to [0,1]
    t = Math.max(0, Math.min(1, t));

    if (metric === 'residual') {
        // Diverging: blue (-) -> white (0) -> red (+)
        if (t < 0.5) {
            const s = t * 2;
            return [Math.round(59 + s * 196), Math.round(76 + s * 179), Math.round(192 + s * 63), 220];
        } else {
            const s = (t - 0.5) * 2;
            return [Math.round(255), Math.round(255 - s * 186), Math.round(255 - s * 186), 220];
        }
    }

    // Sequential: #326B77 (teal) → #CABED0 (lavender) → #A74D30 (terra cotta)
    // Low = cool, Mid = near-white, High = warm
    if (t < 0.5) {
        const s = t * 2;
        return [Math.round(50 + s * 152), Math.round(107 + s * 83), Math.round(119 + s * 89), 220];
    } else {
        const s = (t - 0.5) * 2;
        return [Math.round(202 - s * 35), Math.round(190 - s * 113), Math.round(208 - s * 160), 220];
    }
}

// ============================================================
// Metric label helper
// ============================================================
function getMetricLabel(metric) {
    const labels = {
        uncertainty: 'Uncertainty',
        residual: 'Prediction Error',
        posterior_std: 'Posterior Std',
        n_eff: 'Effective Sample Size',
    };
    return labels[metric] || metric;
}

// ============================================================
// Legends
// ============================================================
function updateLegend(vMin, vMax, metric) {
    const legend = document.getElementById('map-legend');
    legend.innerHTML = `
        <div class="legend-title">${getMetricLabel(metric)}</div>
        <div class="legend-bar"></div>
        <div class="legend-labels">
            <span>${vMin.toFixed(2)}</span>
            <span>${vMax.toFixed(2)}</span>
        </div>
    `;
}

function updateHaloLegend(predMin, predMax, uncMin, uncMax) {
    const legend = document.getElementById('map-legend');
    legend.innerHTML = `
        <div class="legend-title">Predicted Value (color)</div>
        <div class="legend-bar"></div>
        <div class="legend-labels">
            <span>${predMin.toFixed(2)}</span>
            <span>${predMax.toFixed(2)}</span>
        </div>
        <div class="legend-separator"></div>
        <div class="legend-title">Uncertainty (halo size)</div>
        <div class="legend-halo-sizes">
            <div class="halo-size-item">
                <div class="halo-circle halo-small"></div>
                <span>${uncMin.toFixed(3)}</span>
            </div>
            <div class="halo-size-item">
                <div class="halo-circle halo-medium"></div>
                <span>${((uncMin + uncMax) / 2).toFixed(3)}</span>
            </div>
            <div class="halo-size-item">
                <div class="halo-circle halo-large"></div>
                <span>${uncMax.toFixed(3)}</span>
            </div>
        </div>
    `;
}

export { initMap };
