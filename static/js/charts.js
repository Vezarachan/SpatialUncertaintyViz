// D3-based chart panel with 6 tabs
import State from './state.js';

let activeTab = 'coverage';
let currentResults = null;

function initCharts() {
    // Tab click handlers
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            renderActiveChart();
        });
    });

    // Listen for results
    State.on('results', (results) => {
        currentResults = results;
        renderActiveChart();
    });

    // Listen for point selection (for posterior, neff, and uncertainty tabs)
    State.on('pointSelected', () => {
        if (activeTab === 'posterior' || activeTab === 'neff' || activeTab === 'uncertainty') {
            renderActiveChart();
        }
    });

    // Resize handler
    window.addEventListener('resize', debounce(() => {
        if (currentResults) renderActiveChart();
    }, 250));
}

function renderActiveChart() {
    if (!currentResults) return;
    const area = document.getElementById('chart-area');
    area.innerHTML = '';

    const rect = area.getBoundingClientRect();
    const width = rect.width || 600;
    const height = rect.height || 300;

    switch (activeTab) {
        case 'coverage':
            renderCoverage(area, width, height);
            break;
        case 'uncertainty':
            renderUncertaintyHistogram(area, width, height);
            break;
        case 'intervals':
            renderIntervals(area, width, height);
            break;
        case 'posterior':
            renderPosterior(area, width, height);
            break;
        case 'neff':
            renderNeff(area, width, height);
            break;
        case 'residuals':
            renderResiduals(area, width, height);
            break;
    }
}

// ============================================================
// 1. Coverage Gauge
// ============================================================
function renderCoverage(container, width, height) {
    const coverage = currentResults.summary?.coverage;
    const target = currentResults.summary?.target_coverage || 0.9;
    const alpha = 1 - target;

    if (coverage === undefined) {
        container.innerHTML = '<div class="chart-placeholder">No coverage data available.</div>';
        return;
    }

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const cx = width / 2;
    const cy = height * 0.55;
    const radius = Math.min(width, height) * 0.35;

    // Background arc (full semicircle)
    const bgArc = d3.arc()
        .innerRadius(radius - 18)
        .outerRadius(radius)
        .startAngle(-Math.PI / 2)
        .endAngle(Math.PI / 2);

    svg.append('path')
        .attr('d', bgArc())
        .attr('transform', `translate(${cx},${cy})`)
        .attr('fill', '#2a3a5e');

    // Coverage arc
    const coverageAngle = -Math.PI / 2 + Math.PI * Math.min(coverage, 1);
    const covArc = d3.arc()
        .innerRadius(radius - 18)
        .outerRadius(radius)
        .startAngle(-Math.PI / 2)
        .endAngle(coverageAngle);

    const covColor = coverage >= target ? '#2ecc71' : (coverage >= target - 0.05 ? '#f39c12' : '#e74c3c');

    svg.append('path')
        .attr('d', covArc())
        .attr('transform', `translate(${cx},${cy})`)
        .attr('fill', covColor);

    // Target line
    const targetAngle = -Math.PI / 2 + Math.PI * target;
    const targetX = cx + (radius + 6) * Math.cos(targetAngle - Math.PI / 2);
    const targetY = cy + (radius + 6) * Math.sin(targetAngle - Math.PI / 2);
    const targetX2 = cx + (radius - 24) * Math.cos(targetAngle - Math.PI / 2);
    const targetY2 = cy + (radius - 24) * Math.sin(targetAngle - Math.PI / 2);

    svg.append('line')
        .attr('x1', targetX2).attr('y1', targetY2)
        .attr('x2', targetX).attr('y2', targetY)
        .attr('stroke', '#e94560')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,2');

    // Coverage text
    svg.append('text')
        .attr('x', cx)
        .attr('y', cy - 10)
        .attr('text-anchor', 'middle')
        .attr('class', 'gauge-value')
        .text((coverage * 100).toFixed(1) + '%');

    svg.append('text')
        .attr('x', cx)
        .attr('y', cy + 16)
        .attr('text-anchor', 'middle')
        .attr('class', 'gauge-label')
        .text('Empirical Coverage');

    svg.append('text')
        .attr('x', cx)
        .attr('y', cy + 34)
        .attr('text-anchor', 'middle')
        .attr('class', 'gauge-sublabel')
        .text(`Target: ${(target * 100).toFixed(0)}% (\u03B1 = ${alpha.toFixed(2)})`);

    // 0% and 100% labels
    svg.append('text')
        .attr('x', cx - radius - 10)
        .attr('y', cy + 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7394')
        .attr('font-size', '10px')
        .text('0%');

    svg.append('text')
        .attr('x', cx + radius + 10)
        .attr('y', cy + 5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7394')
        .attr('font-size', '10px')
        .text('100%');
}

// ============================================================
// 2. Uncertainty Histogram
// ============================================================
function renderUncertaintyHistogram(container, width, height) {
    const pp = currentResults.per_point;
    const values = pp.uncertainty;
    if (!values || values.length === 0) {
        container.innerHTML = '<div class="chart-placeholder">No uncertainty data available.</div>';
        return;
    }

    const margin = { top: 30, right: 20, bottom: 40, left: 50 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Title
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-title')
        .text('Distribution of Prediction Intervals');

    const x = d3.scaleLinear()
        .domain([d3.min(values) * 0.95, d3.max(values) * 1.05])
        .range([0, w]);

    const bins = d3.bin().domain(x.domain()).thresholds(30)(values);

    const y = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .nice()
        .range([h, 0]);

    // Bars
    g.selectAll('rect')
        .data(bins)
        .join('rect')
        .attr('x', d => x(d.x0) + 1)
        .attr('y', d => y(d.length))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
        .attr('height', d => h - y(d.length))
        .attr('fill', '#e94560')
        .attr('opacity', 0.75);

    // Global threshold line (median)
    const median = d3.median(values);
    g.append('line')
        .attr('x1', x(median))
        .attr('y1', 0)
        .attr('x2', x(median))
        .attr('y2', h)
        .attr('stroke', '#f39c12')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,3');

    g.append('text')
        .attr('x', x(median) + 5)
        .attr('y', 12)
        .attr('fill', '#f39c12')
        .attr('font-size', '10px')
        .text(`Median: ${median.toFixed(3)}`);

    // Selected point marker
    const pointIdx = State.selectedPointIndex;
    if (pointIdx !== null && pointIdx < values.length) {
        const ptVal = values[pointIdx];
        if (Number.isFinite(ptVal)) {
            g.append('line')
                .attr('x1', x(ptVal)).attr('y1', 0)
                .attr('x2', x(ptVal)).attr('y2', h)
                .attr('stroke', '#00e5ff')
                .attr('stroke-width', 2)
                .attr('stroke-dasharray', '3,2');

            g.append('text')
                .attr('x', x(ptVal) + 5)
                .attr('y', 26)
                .attr('fill', '#00e5ff')
                .attr('font-size', '10px')
                .text(`Point #${pointIdx}: ${ptVal.toFixed(3)}`);
        }
    }

    // Axes
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(6));

    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(5));

    // Labels
    g.append('text')
        .attr('x', w / 2)
        .attr('y', h + 35)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Uncertainty (Interval Half-Width)');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2)
        .attr('y', -38)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Count');
}

// ============================================================
// 3. Prediction Intervals (sorted error bars)
// ============================================================
function renderIntervals(container, width, height) {
    const pp = currentResults.per_point;
    if (!pp.lower_bound || !pp.upper_bound || !pp.true_value) {
        container.innerHTML = '<div class="chart-placeholder">No interval data available.</div>';
        return;
    }

    const margin = { top: 30, right: 20, bottom: 40, left: 55 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    // Build and sort by predicted value
    const data = pp.pred_value.map((pred, i) => ({
        index: i,
        pred: pred,
        true_val: pp.true_value[i],
        lower: pp.lower_bound[i],
        upper: pp.upper_bound[i],
        covered: pp.covered[i],
    }));
    data.sort((a, b) => a.pred - b.pred);

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-title')
        .text('Sorted Prediction Intervals');

    const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, w]);
    const allVals = [...data.map(d => d.lower), ...data.map(d => d.upper), ...data.map(d => d.true_val)];
    const y = d3.scaleLinear()
        .domain([d3.min(allVals), d3.max(allVals)])
        .nice()
        .range([h, 0]);

    // Interval bars
    g.selectAll('.interval-bar')
        .data(data)
        .join('line')
        .attr('class', 'interval-bar')
        .attr('x1', (d, i) => x(i))
        .attr('x2', (d, i) => x(i))
        .attr('y1', d => y(d.lower))
        .attr('y2', d => y(d.upper))
        .attr('stroke', d => d.covered ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)')
        .attr('stroke-width', Math.max(1, w / data.length * 0.6));

    // True values
    g.selectAll('.true-dot')
        .data(data)
        .join('circle')
        .attr('class', 'true-dot')
        .attr('cx', (d, i) => x(i))
        .attr('cy', d => y(d.true_val))
        .attr('r', 1.5)
        .attr('fill', '#eaeaea');

    // Axes
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d => Math.round(d)));

    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6));

    // Labels
    g.append('text')
        .attr('x', w / 2)
        .attr('y', h + 35)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Sorted Index');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2)
        .attr('y', -42)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Value');

    // Legend
    const legendG = g.append('g').attr('transform', `translate(${w - 130}, 5)`);
    legendG.append('rect').attr('width', 10).attr('height', 10).attr('fill', 'rgba(46, 204, 113, 0.7)');
    legendG.append('text').attr('x', 14).attr('y', 9).attr('fill', '#a0a8c0').attr('font-size', '10px').text('Covered');
    legendG.append('rect').attr('y', 15).attr('width', 10).attr('height', 10).attr('fill', 'rgba(231, 76, 60, 0.7)');
    legendG.append('text').attr('x', 14).attr('y', 24).attr('fill', '#a0a8c0').attr('font-size', '10px').text('Not Covered');
    legendG.append('circle').attr('cx', 5).attr('cy', 35).attr('r', 3).attr('fill', '#eaeaea');
    legendG.append('text').attr('x', 14).attr('y', 38).attr('fill', '#a0a8c0').attr('font-size', '10px').text('True Value');
}

// ============================================================
// 4. Posterior Density Plot
// ============================================================
function renderPosterior(container, width, height) {
    const pp = currentResults.per_point;
    const pointIdx = State.selectedPointIndex;

    let samples = null;
    let title = 'Posterior Distribution';

    // Posterior samples are at currentResults.posterior_samples_subset (n_test x n_samples)
    if (pointIdx !== null && currentResults.posterior_samples_subset && currentResults.posterior_samples_subset[pointIdx]) {
        samples = currentResults.posterior_samples_subset[pointIdx];
        title = `Posterior Distribution (Point #${pointIdx})`;
    } else if (currentResults.posterior_samples_subset && currentResults.posterior_samples_subset.length > 0) {
        // Show first point as default if none selected
        samples = currentResults.posterior_samples_subset[0];
        title = 'Posterior Distribution (Point #0) - Click map to change';
    }

    if (!samples || samples.length === 0) {
        container.innerHTML = '<div class="chart-placeholder">No posterior samples available. Click a point on the map to view its posterior.</div>';
        return;
    }

    const margin = { top: 30, right: 20, bottom: 40, left: 50 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-title')
        .text(title);

    // Compute kernel density estimation
    const extent = d3.extent(samples);
    const bandwidth = (extent[1] - extent[0]) / 30 || 1;

    const x = d3.scaleLinear()
        .domain([extent[0] - bandwidth * 3, extent[1] + bandwidth * 3])
        .range([0, w]);

    const kde = kernelDensityEstimator(kernelEpanechnikov(bandwidth), x.ticks(80));
    const density = kde(samples);

    const y = d3.scaleLinear()
        .domain([0, d3.max(density, d => d[1])])
        .nice()
        .range([h, 0]);

    // Area
    const area = d3.area()
        .curve(d3.curveBasis)
        .x(d => x(d[0]))
        .y0(h)
        .y1(d => y(d[1]));

    g.append('path')
        .datum(density)
        .attr('d', area)
        .attr('fill', 'rgba(233, 69, 96, 0.25)')
        .attr('stroke', '#e94560')
        .attr('stroke-width', 2);

    // Mean line
    const mean = d3.mean(samples);
    g.append('line')
        .attr('x1', x(mean)).attr('y1', 0)
        .attr('x2', x(mean)).attr('y2', h)
        .attr('stroke', '#f39c12')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5,3');

    g.append('text')
        .attr('x', x(mean) + 5)
        .attr('y', 12)
        .attr('fill', '#f39c12')
        .attr('font-size', '10px')
        .text(`Mean: ${mean.toFixed(3)}`);

    // Axes
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(6));

    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(5));

    g.append('text')
        .attr('x', w / 2)
        .attr('y', h + 35)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Quantile Value');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2)
        .attr('y', -38)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Density');
}

// ============================================================
// 5. N_eff Histogram
// ============================================================
function renderNeff(container, width, height) {
    const pp = currentResults.per_point;
    const values = pp.n_eff;
    if (!values || values.length === 0) {
        container.innerHTML = '<div class="chart-placeholder">No N_eff data available.</div>';
        return;
    }

    const margin = { top: 30, right: 20, bottom: 40, left: 50 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-title')
        .text('Effective Sample Size Distribution');

    const x = d3.scaleLinear()
        .domain([d3.min(values) * 0.95, d3.max(values) * 1.05])
        .range([0, w]);

    const bins = d3.bin().domain(x.domain()).thresholds(25)(values);

    const y = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .nice()
        .range([h, 0]);

    // Bars
    g.selectAll('rect')
        .data(bins)
        .join('rect')
        .attr('x', d => x(d.x0) + 1)
        .attr('y', d => y(d.length))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
        .attr('height', d => h - y(d.length))
        .attr('fill', '#0f3460')
        .attr('stroke', '#344570')
        .attr('opacity', 0.85);

    // Mean line
    const mean = d3.mean(values);
    g.append('line')
        .attr('x1', x(mean)).attr('y1', 0)
        .attr('x2', x(mean)).attr('y2', h)
        .attr('stroke', '#e94560')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,3');

    g.append('text')
        .attr('x', x(mean) + 5)
        .attr('y', 12)
        .attr('fill', '#e94560')
        .attr('font-size', '10px')
        .text(`Mean: ${mean.toFixed(1)}`);

    // Selected point marker
    const pointIdx = State.selectedPointIndex;
    if (pointIdx !== null && pointIdx < values.length) {
        const ptVal = values[pointIdx];
        if (Number.isFinite(ptVal)) {
            g.append('line')
                .attr('x1', x(ptVal)).attr('y1', 0)
                .attr('x2', x(ptVal)).attr('y2', h)
                .attr('stroke', '#00e5ff')
                .attr('stroke-width', 2)
                .attr('stroke-dasharray', '3,2');

            g.append('text')
                .attr('x', x(ptVal) + 5)
                .attr('y', 26)
                .attr('fill', '#00e5ff')
                .attr('font-size', '10px')
                .text(`Point #${pointIdx}: ${ptVal.toFixed(1)}`);
        }
    }

    // Axes
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(6));

    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(5));

    g.append('text')
        .attr('x', w / 2)
        .attr('y', h + 35)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Effective Sample Size (N_eff)');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2)
        .attr('y', -38)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Count');
}

// ============================================================
// 6. Residuals (Pred vs True Scatter)
// ============================================================
function renderResiduals(container, width, height) {
    const pp = currentResults.per_point;
    if (!pp.pred_value || !pp.true_value) {
        container.innerHTML = '<div class="chart-placeholder">No residual data available.</div>';
        return;
    }

    const margin = { top: 30, right: 20, bottom: 40, left: 55 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    const data = pp.pred_value.map((pred, i) => ({
        pred,
        true_val: pp.true_value[i],
        covered: pp.covered ? pp.covered[i] : true,
    }));

    const allVals = [...data.map(d => d.pred), ...data.map(d => d.true_val)];
    const vMin = d3.min(allVals);
    const vMax = d3.max(allVals);

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', 18)
        .attr('text-anchor', 'middle')
        .attr('class', 'chart-title')
        .text('Predicted vs True Values');

    const x = d3.scaleLinear().domain([vMin, vMax]).nice().range([0, w]);
    const y = d3.scaleLinear().domain([vMin, vMax]).nice().range([h, 0]);

    // 1:1 line
    g.append('line')
        .attr('x1', x(vMin)).attr('y1', y(vMin))
        .attr('x2', x(vMax)).attr('y2', y(vMax))
        .attr('stroke', '#6b7394')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '6,3');

    // Points
    g.selectAll('circle')
        .data(data)
        .join('circle')
        .attr('cx', d => x(d.true_val))
        .attr('cy', d => y(d.pred))
        .attr('r', 3.5)
        .attr('fill', d => d.covered ? 'rgba(46, 204, 113, 0.6)' : 'rgba(233, 69, 96, 0.6)')
        .attr('stroke', d => d.covered ? '#2ecc71' : '#e94560')
        .attr('stroke-width', 0.5);

    // Axes
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(x).ticks(6));

    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(6));

    g.append('text')
        .attr('x', w / 2)
        .attr('y', h + 35)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('True Value');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -h / 2)
        .attr('y', -42)
        .attr('text-anchor', 'middle')
        .attr('class', 'axis-label')
        .text('Predicted Value');

    // R-squared annotation
    if (currentResults.summary?.r2 !== undefined) {
        g.append('text')
            .attr('x', w - 5)
            .attr('y', 15)
            .attr('text-anchor', 'end')
            .attr('fill', '#a0a8c0')
            .attr('font-size', '11px')
            .text(`R\u00B2 = ${currentResults.summary.r2.toFixed(4)}`);
    }
}

// ============================================================
// KDE Helper Functions
// ============================================================
function kernelDensityEstimator(kernel, xs) {
    return function (samples) {
        return xs.map(x => [x, d3.mean(samples, v => kernel(x - v))]);
    };
}

function kernelEpanechnikov(bandwidth) {
    return function (u) {
        u = u / bandwidth;
        return Math.abs(u) <= 1 ? (0.75 * (1 - u * u)) / bandwidth : 0;
    };
}

// ============================================================
// Utility
// ============================================================
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export { initCharts };
