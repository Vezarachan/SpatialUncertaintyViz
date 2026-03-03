// Map visualization with Deck.gl
import State from './state.js';

let map = null;
let deckOverlay = null;
let currentData = null;
let currentDataExtent = 100; // diagonal degrees of data extent
let mapLoaded = false;
let pendingResults = null; // queue results if map not ready

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

// Safe min/max for large arrays (avoids spread operator stack overflow)
// Also skips NaN / Infinity
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

function updateLayers(results, metric) {
    const pp = results.per_point;
    if (!pp) return;

    const values = pp[metric] || pp.uncertainty;
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
        onHover: (info) => {
            const tooltip = document.getElementById('tooltip');
            if (info.object) {
                const d = info.object;
                tooltip.innerHTML = `
                    <strong>Point #${d.index}</strong><br>
                    True: ${d.trueValue.toFixed(3)}<br>
                    Predicted: ${d.predValue.toFixed(3)}<br>
                    Uncertainty: ${d.uncertainty.toFixed(3)}<br>
                    Covered: ${d.covered ? 'Yes' : 'No'}<br>
                    Residual: ${d.residual.toFixed(3)}
                `;
                tooltip.style.left = info.x + 10 + 'px';
                tooltip.style.top = info.y + 10 + 'px';
                tooltip.classList.remove('hidden');
            } else {
                tooltip.classList.add('hidden');
            }
        },
    });

    deckOverlay.setProps({ layers: [scatterLayer] });
    updateLegend(vMin, vMax, metric);
}

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

    // Sequential: deep blue → cyan → green → yellow → red
    // More visible at low values than the previous scheme
    if (t < 0.25) {
        const s = t * 4;
        return [30, Math.round(60 + s * 140), Math.round(180 + s * 40), 220];
    } else if (t < 0.5) {
        const s = (t - 0.25) * 4;
        return [Math.round(30 + s * 100), Math.round(200 - s * 10), Math.round(220 - s * 140), 220];
    } else if (t < 0.75) {
        const s = (t - 0.5) * 4;
        return [Math.round(130 + s * 125), Math.round(190 + s * 50), Math.round(80 - s * 60), 220];
    } else {
        const s = (t - 0.75) * 4;
        return [255, Math.round(240 - s * 180), Math.round(20 - s * 20), 220];
    }
}

function updateLegend(vMin, vMax, metric) {
    const legend = document.getElementById('map-legend');
    const labels = {
        uncertainty: 'Uncertainty',
        residual: 'Prediction Error',
        posterior_std: 'Posterior Std',
        n_eff: 'Effective Sample Size',
    };
    legend.innerHTML = `
        <div class="legend-title">${labels[metric] || metric}</div>
        <div class="legend-bar"></div>
        <div class="legend-labels">
            <span>${vMin.toFixed(2)}</span>
            <span>${vMax.toFixed(2)}</span>
        </div>
    `;
}

export { initMap };
