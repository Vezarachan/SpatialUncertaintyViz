// Method Drawer: overlay with CP method explanations, KaTeX formulas, and D3 demos
import { CP_INTRO, GROUP_DESCRIPTIONS, METHOD_CONTENT } from './methodContent.js';

let drawerBuilt = false;

// ============================================================
// Public API
// ============================================================
function initDrawer() {
    // Info banner toggle
    const bannerToggle = document.getElementById('info-banner-toggle');
    const banner = document.getElementById('info-banner');
    if (bannerToggle && banner) {
        bannerToggle.addEventListener('click', () => banner.classList.toggle('open'));
    }

    // "About CP Methods" button
    const aboutBtn = document.getElementById('btn-about-methods');
    if (aboutBtn) {
        aboutBtn.addEventListener('click', () => openDrawer());
    }

    // Close button
    const closeBtn = document.getElementById('drawer-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeDrawer);
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawer();
    });
}

function openDrawer(methodKey) {
    const drawer = document.getElementById('method-drawer');
    if (!drawer) return;

    if (!drawerBuilt) {
        buildDrawerContent();
        drawerBuilt = true;
    }

    drawer.classList.remove('hidden');

    // Scroll to specific method if requested
    if (methodKey) {
        requestAnimationFrame(() => {
            const card = document.getElementById(`method-card-${methodKey}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.borderColor = 'var(--accent)';
                setTimeout(() => { card.style.borderColor = ''; }, 2000);
            }
        });
    }
}

function closeDrawer() {
    const drawer = document.getElementById('method-drawer');
    if (drawer) drawer.classList.add('hidden');
}

// ============================================================
// Build all drawer content
// ============================================================
function buildDrawerContent() {
    const body = document.getElementById('drawer-body');
    if (!body) return;

    // Intro paragraph
    const intro = document.createElement('div');
    intro.className = 'drawer-intro';
    intro.innerHTML = `<p>${CP_INTRO}</p>`;
    body.appendChild(intro);

    // Split CP workflow diagram
    body.appendChild(buildWorkflowDiagram());

    // Group methods by group
    const groups = {};
    const groupOrder = ['Standard CP', 'Spatial CP', 'Feature-Space CP', 'Alternative'];

    Object.entries(METHOD_CONTENT).forEach(([key, info]) => {
        const g = info.group;
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key, ...info });
    });

    groupOrder.forEach(groupName => {
        const methods = groups[groupName];
        if (!methods) return;

        const section = document.createElement('div');
        section.className = 'drawer-group';

        const title = document.createElement('div');
        title.className = 'drawer-group-title';
        title.textContent = groupName;
        section.appendChild(title);

        if (GROUP_DESCRIPTIONS[groupName]) {
            const desc = document.createElement('div');
            desc.className = 'drawer-group-desc';
            desc.textContent = GROUP_DESCRIPTIONS[groupName];
            section.appendChild(desc);
        }

        methods.forEach(m => {
            section.appendChild(buildMethodCard(m));
        });

        body.appendChild(section);
    });

    // Render KaTeX formulas after DOM is built
    renderFormulas();
}

// ============================================================
// Build a single method card
// ============================================================
function buildMethodCard(method) {
    const card = document.createElement('div');
    card.className = 'method-card';
    card.id = `method-card-${method.key}`;

    // Title + badges
    const titleEl = document.createElement('div');
    titleEl.className = 'method-card-title';
    titleEl.textContent = method.title;
    method.badges.forEach(b => {
        const badge = document.createElement('span');
        badge.className = 'method-badge';
        badge.textContent = b;
        titleEl.appendChild(badge);
    });
    card.appendChild(titleEl);

    // Description
    const desc = document.createElement('div');
    desc.className = 'method-card-desc';
    desc.textContent = method.description;
    card.appendChild(desc);

    // Formula block
    if (method.formula) {
        const formulaBlock = document.createElement('div');
        formulaBlock.className = 'method-formula';

        const formulaEl = document.createElement('div');
        formulaEl.className = 'katex-formula';
        formulaEl.dataset.formula = method.formula;
        formulaBlock.appendChild(formulaEl);

        if (method.formulaExplain) {
            const explain = document.createElement('div');
            explain.className = 'method-formula-explain';
            explain.textContent = method.formulaExplain;
            formulaBlock.appendChild(explain);
        }
        card.appendChild(formulaBlock);
    }

    // Key idea
    if (method.keyIdea) {
        const idea = document.createElement('div');
        idea.className = 'method-key-idea';
        idea.innerHTML = `<strong>Key Idea:</strong> ${method.keyIdea}`;
        card.appendChild(idea);
    }

    // Interactive demo
    if (method.demoType) {
        const demo = buildDemo(method.demoType, method.key);
        if (demo) card.appendChild(demo);
    }

    return card;
}

// ============================================================
// KaTeX rendering (with retry for async loading)
// ============================================================
function renderFormulas() {
    const render = () => {
        if (typeof katex === 'undefined') {
            setTimeout(render, 200);
            return;
        }
        document.querySelectorAll('.katex-formula').forEach(el => {
            const tex = el.dataset.formula;
            if (tex) {
                try {
                    katex.render(tex, el, { displayMode: true, throwOnError: false });
                } catch (e) {
                    el.textContent = tex;
                }
            }
        });
    };
    render();
}

// ============================================================
// Split CP Workflow Diagram (compact with zoom)
// ============================================================
function buildWorkflowDiagram() {
    const wrapper = document.createElement('div');
    wrapper.className = 'workflow-section';
    wrapper.innerHTML = `<div class="drawer-group-title">Split Conformal Prediction Workflow</div>
        <div class="drawer-group-desc">All CP methods in this tool follow the split conformal prediction framework. If no pre-trained model is provided, the data is split into Train, Calibration, and Test sets; otherwise only Calibration and Test sets are needed.</div>`;

    const vizOuter = document.createElement('div');
    vizOuter.className = 'workflow-viz';

    // Zoom controls
    const zoomBar = document.createElement('div');
    zoomBar.className = 'workflow-zoom-bar';
    zoomBar.innerHTML = `
        <button class="wf-zoom-btn" data-action="out" title="Zoom out">&minus;</button>
        <span class="wf-zoom-level">100%</span>
        <button class="wf-zoom-btn" data-action="in" title="Zoom in">+</button>
        <button class="wf-zoom-btn wf-zoom-reset" data-action="reset" title="Reset">Reset</button>
    `;
    vizOuter.appendChild(zoomBar);

    const vizDiv = document.createElement('div');
    vizDiv.className = 'workflow-viz-inner';
    vizOuter.appendChild(vizDiv);
    wrapper.appendChild(vizOuter);

    // Zoom state
    let zoomLevel = 1;
    const zoomSteps = [0.6, 0.75, 0.9, 1, 1.2, 1.5, 2.0];
    let zoomIdx = 3; // start at 1.0
    const levelSpan = zoomBar.querySelector('.wf-zoom-level');

    function applyZoom() {
        zoomLevel = zoomSteps[zoomIdx];
        vizDiv.style.transform = `scale(${zoomLevel})`;
        vizDiv.style.transformOrigin = 'center top';
        levelSpan.textContent = Math.round(zoomLevel * 100) + '%';
    }

    zoomBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.wf-zoom-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'in' && zoomIdx < zoomSteps.length - 1) zoomIdx++;
        else if (action === 'out' && zoomIdx > 0) zoomIdx--;
        else if (action === 'reset') zoomIdx = 3;
        applyZoom();
    });

    requestAnimationFrame(() => {
        const W = 460, H = 270;
        const svg = d3.select(vizDiv).append('svg')
            .attr('viewBox', `0 0 ${W} ${H}`)
            .attr('width', '100%')
            .attr('preserveAspectRatio', 'xMidYMid meet');

        // Arrow marker
        svg.append('defs').append('marker')
            .attr('id', 'wf-arrow')
            .attr('viewBox', '0 0 10 6')
            .attr('refX', 10).attr('refY', 3)
            .attr('markerWidth', 7).attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,0 L10,3 L0,6 Z')
            .attr('fill', 'var(--text-muted)');

        const boxH = 24, rx = 4;
        const colors = {
            data: '#0f3460', split: '#16213e',
            train: '#2a5a3e', calib: '#5a3a2e', test: '#2e3a5a',
            process: '#1e2a4a', result: '#3a1a3a',
        };
        const border = 'var(--border-light)';
        const textColor = 'var(--text-primary)';
        const mutedText = 'var(--text-muted)';

        function drawBox(x, y, w, h, fill, label, sublabel) {
            const g = svg.append('g');
            g.append('rect')
                .attr('x', x - w / 2).attr('y', y - h / 2)
                .attr('width', w).attr('height', h)
                .attr('rx', rx).attr('fill', fill)
                .attr('stroke', border).attr('stroke-width', 0.8);
            g.append('text')
                .attr('x', x).attr('y', sublabel ? y - 2 : y + 1)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('fill', textColor)
                .attr('font-size', '10px')
                .attr('font-weight', '600')
                .text(label);
            if (sublabel) {
                g.append('text')
                    .attr('x', x).attr('y', y + 10)
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'middle')
                    .attr('fill', mutedText)
                    .attr('font-size', '8px')
                    .text(sublabel);
            }
            return g;
        }

        function arrow(x1, y1, x2, y2) {
            svg.append('line')
                .attr('x1', x1).attr('y1', y1)
                .attr('x2', x2).attr('y2', y2)
                .attr('stroke', mutedText)
                .attr('stroke-width', 1)
                .attr('marker-end', 'url(#wf-arrow)');
        }

        function curvedArrow(x1, y1, x2, y2, bend) {
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2 + (bend || 0);
            svg.append('path')
                .attr('d', `M${x1},${y1} Q${mx},${my} ${x2},${y2}`)
                .attr('fill', 'none')
                .attr('stroke', mutedText)
                .attr('stroke-width', 1)
                .attr('marker-end', 'url(#wf-arrow)');
        }

        // --- Compact layout ---
        const cx = 230; // center x

        // Row 1: Dataset
        drawBox(cx, 16, 120, boxH, colors.data, 'Full Dataset');

        // Row 2: Split
        arrow(cx, 29, cx, 42);
        drawBox(cx, 54, 170, boxH, colors.split, 'Split (Train / Calib / Test)');

        // Row 3: Three sets
        curvedArrow(160, 66, 80, 86, 4);
        arrow(cx, 66, cx, 86);
        curvedArrow(300, 66, 375, 86, 4);

        drawBox(80, 98, 85, boxH, colors.train, 'Train Set');
        drawBox(cx, 98, 90, boxH, colors.calib, 'Calib Set');
        drawBox(375, 98, 85, boxH, colors.test, 'Test Set');

        // Note about pretrained model
        svg.append('text')
            .attr('x', 80).attr('y', 122)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--accent)')
            .attr('font-size', '7px')
            .attr('font-style', 'italic')
            .text('(skip if pre-trained)');

        // Row 4: Fit Model
        arrow(80, 110, 80, 132);
        drawBox(80, 144, 100, boxH, colors.process, 'Fit Model \u03BC\u0302(x)');

        // Arrow from Fit Model to residuals
        arrow(130, 144, 158, 172);

        // Arrow from Calib to residuals
        arrow(cx, 110, cx, 170);

        // Row 5: Nonconformity Scores
        drawBox(cx, 188, 200, 32, colors.process, 'Nonconformity Scores', 'R\u1d62 = |Y\u1d62 \u2212 \u03BC\u0302(X\u1d62)| on Calib');

        // Arrow from Test to PI
        arrow(375, 110, 375, 226);
        curvedArrow(375, 226, 320, 238, 6);

        // Arrow from Scores to PI
        arrow(cx, 204, cx, 232);

        // Row 6: Prediction Intervals
        drawBox(cx, 248, 230, 34, colors.result, 'Prediction Intervals', '\u0177(x) \u00B1 Q\u2081\u208B\u03B1({w\u1d62 \u00B7 R\u1d62}) \u2192 Uncertainty');

        // Spatial CP highlight (to the right)
        svg.append('rect')
            .attr('x', 348).attr('y', 230)
            .attr('width', 108).attr('height', 34)
            .attr('rx', 3)
            .attr('fill', 'none')
            .attr('stroke', 'var(--accent)')
            .attr('stroke-width', 0.8)
            .attr('stroke-dasharray', '3,2');

        svg.append('text')
            .attr('x', 402).attr('y', 244)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--accent)')
            .attr('font-size', '8px')
            .attr('font-weight', '600')
            .text('Spatial CP variants');

        svg.append('text')
            .attr('x', 402).attr('y', 256)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--accent)')
            .attr('font-size', '7px')
            .text('weight w\u1d62 by distance');
    });

    return wrapper;
}

// ============================================================
// Demo builder — dispatches to specific demo types
// ============================================================
function buildDemo(demoType, methodKey) {
    const container = document.createElement('div');
    container.className = 'demo-container';

    const header = document.createElement('div');
    header.className = 'demo-header';
    header.textContent = 'Interactive Demo';
    container.appendChild(header);

    switch (demoType) {
        case 'weight_distribution':
            buildWeightDemo(container, methodKey);
            break;
        case 'posterior_sampling':
            buildPosteriorDemo(container);
            break;
        case 'adaptive_bandwidth':
            buildAdaptiveDemo(container);
            break;
        case 'knn_weights':
            buildKnnDemo(container);
            break;
        case 'lambda_balance':
            buildLambdaDemo(container);
            break;
        default:
            return null;
    }

    return container;
}

// ============================================================
// Demo 1: Weight Distribution (GeoCP / GeoBCP)
// ============================================================
function buildWeightDemo(container, methodKey) {
    const controls = document.createElement('div');
    controls.className = 'demo-controls';
    controls.innerHTML = `
        <label>Bandwidth h:</label>
        <input type="range" min="0.05" max="0.5" step="0.01" value="0.15" class="demo-bw-slider">
        <span class="demo-val demo-bw-val">0.15</span>
    `;
    container.appendChild(controls);

    const viz = document.createElement('div');
    viz.className = 'demo-viz';
    container.appendChild(viz);

    // Defer rendering to next frame
    requestAnimationFrame(() => {
        const W = viz.clientWidth || 360;
        const H = 180;
        const svg = d3.select(viz).append('svg').attr('viewBox', `0 0 ${W} ${H}`);

        // Generate random calibration points
        const rng = d3.randomNormal(0.5, 0.2);
        const pts = d3.range(30).map(() => [Math.max(0.05, Math.min(0.95, rng())), Math.max(0.05, Math.min(0.95, rng()))]);
        const testPt = [0.5, 0.5];

        const xScale = d3.scaleLinear().domain([0, 1]).range([30, W - 10]);
        const yScale = d3.scaleLinear().domain([0, 1]).range([H - 20, 10]);

        function update(bw) {
            svg.selectAll('*').remove();

            // Compute weights
            const weights = pts.map(p => {
                const dx = p[0] - testPt[0], dy = p[1] - testPt[1];
                return Math.exp(-(dx * dx + dy * dy) / (2 * bw * bw));
            });
            const maxW = d3.max(weights) || 1;

            // Draw weight circles (halos)
            svg.selectAll('.weight-halo')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScale(d[0]))
                .attr('cy', d => yScale(d[1]))
                .attr('r', (d, i) => 3 + (weights[i] / maxW) * 12)
                .attr('fill', (d, i) => {
                    const t = weights[i] / maxW;
                    return `rgba(233, 69, 96, ${0.1 + t * 0.5})`;
                })
                .attr('stroke', 'none');

            // Draw calibration points
            svg.selectAll('.cal-pt')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScale(d[0]))
                .attr('cy', d => yScale(d[1]))
                .attr('r', 3)
                .attr('fill', (d, i) => d3.interpolateRgb('#344570', '#e94560')(weights[i] / maxW))
                .attr('stroke', '#1a1a2e')
                .attr('stroke-width', 0.5);

            // Draw bandwidth circle around test point
            const bwPx = (xScale(testPt[0] + bw) - xScale(testPt[0]));
            svg.append('circle')
                .attr('cx', xScale(testPt[0]))
                .attr('cy', yScale(testPt[1]))
                .attr('r', bwPx)
                .attr('fill', 'none')
                .attr('stroke', 'var(--accent)')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4,3')
                .attr('opacity', 0.6);

            // Draw test point
            svg.append('circle')
                .attr('cx', xScale(testPt[0]))
                .attr('cy', yScale(testPt[1]))
                .attr('r', 5)
                .attr('fill', '#00e5ff')
                .attr('stroke', '#fff')
                .attr('stroke-width', 1.5);

            // Labels
            svg.append('text')
                .attr('x', xScale(testPt[0]) + 8)
                .attr('y', yScale(testPt[1]) - 6)
                .attr('fill', '#00e5ff')
                .attr('font-size', '9px')
                .text('test point');
        }

        update(0.15);

        const slider = controls.querySelector('.demo-bw-slider');
        const valSpan = controls.querySelector('.demo-bw-val');
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            valSpan.textContent = v.toFixed(2);
            update(v);
        });
    });
}

// ============================================================
// Demo 2: Posterior Sampling (BQCP)
// ============================================================
function buildPosteriorDemo(container) {
    const controls = document.createElement('div');
    controls.className = 'demo-controls';
    controls.innerHTML = `
        <label>\u03b2:</label>
        <input type="range" min="0.1" max="5" step="0.1" value="1.0" class="demo-beta-slider">
        <span class="demo-val demo-beta-val">1.0</span>
        <label style="margin-left:8px">\u03b1:</label>
        <span class="demo-val">0.10</span>
    `;
    container.appendChild(controls);

    const viz = document.createElement('div');
    viz.className = 'demo-viz';
    container.appendChild(viz);

    requestAnimationFrame(() => {
        const W = viz.clientWidth || 360;
        const H = 180;
        const svg = d3.select(viz).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
        const alpha = 0.1;

        // Generate fake calibration residuals
        const nCal = 50;
        const residuals = d3.range(nCal).map(() => Math.abs(d3.randomNormal(0, 1)())).sort(d3.ascending);

        function sampleDirichlet(n, beta) {
            const gammas = d3.range(n).map(() => {
                // Gamma(beta,1) via Marsaglia-Tsang for beta >= 1
                // For simplicity use the exponential approximation
                let sum = 0;
                for (let j = 0; j < Math.ceil(beta); j++) sum -= Math.log(Math.random());
                return sum;
            });
            const total = d3.sum(gammas);
            return gammas.map(g => g / total);
        }

        function weightedQuantile(values, weights, q) {
            // Compute weighted quantile
            const pairs = values.map((v, i) => ({ v, w: weights[i] }));
            pairs.sort((a, b) => a.v - b.v);
            let cumW = 0;
            for (const p of pairs) {
                cumW += p.w;
                if (cumW >= q) return p.v;
            }
            return pairs[pairs.length - 1].v;
        }

        function update(beta) {
            svg.selectAll('*').remove();
            const nSamples = 200;
            const thresholds = [];
            for (let s = 0; s < nSamples; s++) {
                const w = sampleDirichlet(nCal, beta);
                thresholds.push(weightedQuantile(residuals, w, 1 - alpha));
            }

            // Histogram of thresholds
            const xMin = d3.min(thresholds) * 0.9;
            const xMax = d3.max(thresholds) * 1.1;
            const x = d3.scaleLinear().domain([xMin, xMax]).range([40, W - 10]);
            const bins = d3.bin().domain([xMin, xMax]).thresholds(20)(thresholds);
            const yMax = d3.max(bins, b => b.length);
            const y = d3.scaleLinear().domain([0, yMax]).range([H - 25, 10]);

            svg.selectAll('.bar')
                .data(bins).enter()
                .append('rect')
                .attr('x', b => x(b.x0) + 0.5)
                .attr('y', b => y(b.length))
                .attr('width', b => Math.max(0, x(b.x1) - x(b.x0) - 1))
                .attr('height', b => H - 25 - y(b.length))
                .attr('fill', 'var(--accent)')
                .attr('opacity', 0.6);

            // Standard CP quantile line
            const stdQ = residuals[Math.ceil((1 - alpha) * (nCal + 1)) - 1] || residuals[nCal - 1];
            svg.append('line')
                .attr('x1', x(stdQ)).attr('y1', 5)
                .attr('x2', x(stdQ)).attr('y2', H - 25)
                .attr('stroke', '#00e5ff')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '4,3');

            svg.append('text')
                .attr('x', x(stdQ) + 4).attr('y', 14)
                .attr('fill', '#00e5ff').attr('font-size', '9px')
                .text('Std CP');

            // Axis
            const xAxis = d3.axisBottom(x).ticks(5).tickFormat(d3.format('.2f'));
            svg.append('g')
                .attr('transform', `translate(0,${H - 25})`)
                .call(xAxis)
                .selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '9px');
            svg.selectAll('.domain, .tick line').attr('stroke', 'var(--border-light)');

            svg.append('text')
                .attr('x', W / 2).attr('y', H - 2)
                .attr('text-anchor', 'middle')
                .attr('fill', 'var(--text-muted)').attr('font-size', '9px')
                .text('Posterior threshold distribution');
        }

        update(1.0);

        const slider = controls.querySelector('.demo-beta-slider');
        const valSpan = controls.querySelector('.demo-beta-val');
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            valSpan.textContent = v.toFixed(1);
            update(v);
        });
    });
}

// ============================================================
// Demo 3: Adaptive Bandwidth
// ============================================================
function buildAdaptiveDemo(container) {
    const controls = document.createElement('div');
    controls.className = 'demo-controls';
    controls.innerHTML = `
        <label>Base h\u2080:</label>
        <input type="range" min="0.05" max="0.4" step="0.01" value="0.15" class="demo-basebw-slider">
        <span class="demo-val demo-basebw-val">0.15</span>
        <label style="margin-left:8px">k:</label>
        <input type="range" min="3" max="15" step="1" value="5" class="demo-k-slider">
        <span class="demo-val demo-k-val">5</span>
    `;
    container.appendChild(controls);

    const viz = document.createElement('div');
    viz.className = 'demo-viz';
    container.appendChild(viz);

    requestAnimationFrame(() => {
        const W = viz.clientWidth || 360;
        const H = 180;
        const svg = d3.select(viz).append('svg').attr('viewBox', `0 0 ${W} ${H}`);

        // Non-uniform points: dense cluster + sparse region
        const pts = [];
        for (let i = 0; i < 20; i++) pts.push([0.2 + Math.random() * 0.2, 0.3 + Math.random() * 0.4]);
        for (let i = 0; i < 8; i++) pts.push([0.6 + Math.random() * 0.3, 0.2 + Math.random() * 0.6]);

        const xScale = d3.scaleLinear().domain([0, 1]).range([30, W - 10]);
        const yScale = d3.scaleLinear().domain([0, 1]).range([H - 20, 10]);

        function kthDist(ptIdx, k) {
            const dists = pts.map((p, i) => {
                if (i === ptIdx) return Infinity;
                const dx = p[0] - pts[ptIdx][0], dy = p[1] - pts[ptIdx][1];
                return Math.sqrt(dx * dx + dy * dy);
            }).sort(d3.ascending);
            return dists[Math.min(k - 1, dists.length - 1)];
        }

        function update(baseBw, k) {
            svg.selectAll('*').remove();

            const kDists = pts.map((_, i) => kthDist(i, k));
            const medKDist = d3.median(kDists) || 0.1;
            const adaptiveBws = kDists.map(d => baseBw * (d / medKDist));

            // Draw adaptive bandwidth circles
            svg.selectAll('.bw-circle')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScale(d[0]))
                .attr('cy', d => yScale(d[1]))
                .attr('r', (d, i) => Math.abs(xScale(pts[i][0] + adaptiveBws[i]) - xScale(pts[i][0])))
                .attr('fill', 'none')
                .attr('stroke', 'var(--accent)')
                .attr('stroke-width', 0.7)
                .attr('stroke-dasharray', '2,2')
                .attr('opacity', 0.5);

            // Draw points colored by bandwidth
            const bwExtent = d3.extent(adaptiveBws);
            const bwScale = d3.scaleLinear().domain(bwExtent).range([0, 1]);

            svg.selectAll('.pt')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScale(d[0]))
                .attr('cy', d => yScale(d[1]))
                .attr('r', 4)
                .attr('fill', (d, i) => d3.interpolateRgb('#326B77', '#A74D30')(bwScale(adaptiveBws[i])))
                .attr('stroke', '#1a1a2e')
                .attr('stroke-width', 0.5);

            // Legend
            svg.append('text')
                .attr('x', 32).attr('y', 14)
                .attr('fill', 'var(--text-muted)').attr('font-size', '9px')
                .text('Teal = small h (dense)  |  Red = large h (sparse)');
        }

        update(0.15, 5);

        const bwSlider = controls.querySelector('.demo-basebw-slider');
        const bwVal = controls.querySelector('.demo-basebw-val');
        const kSlider = controls.querySelector('.demo-k-slider');
        const kVal = controls.querySelector('.demo-k-val');

        bwSlider.addEventListener('input', () => {
            bwVal.textContent = parseFloat(bwSlider.value).toFixed(2);
            update(parseFloat(bwSlider.value), parseInt(kSlider.value));
        });
        kSlider.addEventListener('input', () => {
            kVal.textContent = kSlider.value;
            update(parseFloat(bwSlider.value), parseInt(kSlider.value));
        });
    });
}

// ============================================================
// Demo 4: k-NN Weights (Localized CP)
// ============================================================
function buildKnnDemo(container) {
    const controls = document.createElement('div');
    controls.className = 'demo-controls';
    controls.innerHTML = `
        <label>k:</label>
        <input type="range" min="3" max="25" step="1" value="8" class="demo-knn-slider">
        <span class="demo-val demo-knn-val">8</span>
    `;
    container.appendChild(controls);

    const viz = document.createElement('div');
    viz.className = 'demo-viz';
    container.appendChild(viz);

    requestAnimationFrame(() => {
        const W = viz.clientWidth || 360;
        const H = 180;
        const svg = d3.select(viz).append('svg').attr('viewBox', `0 0 ${W} ${H}`);

        // Points in a 2D feature space
        const pts = d3.range(35).map(() => [Math.random(), Math.random()]);
        const testPt = [0.5, 0.5];

        const xScale = d3.scaleLinear().domain([0, 1]).range([30, W - 10]);
        const yScale = d3.scaleLinear().domain([0, 1]).range([H - 20, 10]);

        function update(k) {
            svg.selectAll('*').remove();

            // Compute feature distances
            const dists = pts.map((p, i) => ({
                i,
                dist: Math.sqrt((p[0] - testPt[0]) ** 2 + (p[1] - testPt[1]) ** 2),
            }));
            dists.sort((a, b) => a.dist - b.dist);
            const knnSet = new Set(dists.slice(0, k).map(d => d.i));

            // Draw connecting lines to kNN
            dists.slice(0, k).forEach(d => {
                svg.append('line')
                    .attr('x1', xScale(testPt[0]))
                    .attr('y1', yScale(testPt[1]))
                    .attr('x2', xScale(pts[d.i][0]))
                    .attr('y2', yScale(pts[d.i][1]))
                    .attr('stroke', 'var(--accent)')
                    .attr('stroke-width', 0.7)
                    .attr('opacity', 0.4);
            });

            // Draw points
            svg.selectAll('.pt')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScale(d[0]))
                .attr('cy', d => yScale(d[1]))
                .attr('r', (d, i) => knnSet.has(i) ? 5 : 3)
                .attr('fill', (d, i) => knnSet.has(i) ? 'var(--accent)' : '#344570')
                .attr('stroke', (d, i) => knnSet.has(i) ? '#fff' : '#1a1a2e')
                .attr('stroke-width', (d, i) => knnSet.has(i) ? 1 : 0.5)
                .attr('opacity', (d, i) => knnSet.has(i) ? 1 : 0.5);

            // Test point
            svg.append('circle')
                .attr('cx', xScale(testPt[0]))
                .attr('cy', yScale(testPt[1]))
                .attr('r', 6)
                .attr('fill', '#00e5ff')
                .attr('stroke', '#fff')
                .attr('stroke-width', 1.5);

            // Labels
            svg.append('text')
                .attr('x', 32).attr('y', 14)
                .attr('fill', 'var(--text-muted)').attr('font-size', '9px')
                .text(`Feature space: ${k} nearest neighbors highlighted`);
        }

        update(8);

        const slider = controls.querySelector('.demo-knn-slider');
        const valSpan = controls.querySelector('.demo-knn-val');
        slider.addEventListener('input', () => {
            valSpan.textContent = slider.value;
            update(parseInt(slider.value));
        });
    });
}

// ============================================================
// Demo 5: Lambda Balance (GeoSim CP)
// ============================================================
function buildLambdaDemo(container) {
    const controls = document.createElement('div');
    controls.className = 'demo-controls';
    controls.innerHTML = `
        <label>\u03bb:</label>
        <input type="range" min="0" max="1" step="0.05" value="0.5" class="demo-lambda-slider">
        <span class="demo-val demo-lambda-val">0.50</span>
        <span class="demo-val" style="margin-left:6px;color:var(--text-muted);font-size:9px">
            (1=spatial, 0=feature)
        </span>
    `;
    container.appendChild(controls);

    const viz = document.createElement('div');
    viz.className = 'demo-viz';
    container.appendChild(viz);

    requestAnimationFrame(() => {
        const W = viz.clientWidth || 360;
        const H = 180;
        const svg = d3.select(viz).append('svg').attr('viewBox', `0 0 ${W} ${H}`);

        // Generate points with spatial coords and a feature value
        const pts = d3.range(30).map(() => ({
            sx: Math.random(), sy: Math.random(), // spatial
            fx: Math.random(), // single feature
        }));
        const testPt = { sx: 0.5, sy: 0.5, fx: 0.5 };

        const halfW = (W - 20) / 2;
        const xScaleS = d3.scaleLinear().domain([0, 1]).range([15, halfW - 5]);
        const yScaleS = d3.scaleLinear().domain([0, 1]).range([H - 25, 15]);
        const xScaleF = d3.scaleLinear().domain([0, 1]).range([halfW + 15, W - 5]);

        function update(lambda) {
            svg.selectAll('*').remove();

            // Compute combined distance
            const spatDists = pts.map(p => Math.sqrt((p.sx - testPt.sx) ** 2 + (p.sy - testPt.sy) ** 2));
            const featDists = pts.map(p => Math.abs(p.fx - testPt.fx));
            const maxSD = d3.max(spatDists) || 1;
            const maxFD = d3.max(featDists) || 1;

            const combined = pts.map((_, i) =>
                lambda * (spatDists[i] / maxSD) + (1 - lambda) * (featDists[i] / maxFD)
            );
            const maxC = d3.max(combined) || 1;
            const weights = combined.map(c => 1 - c / maxC);

            // Separator line
            svg.append('line')
                .attr('x1', halfW + 5).attr('y1', 5)
                .attr('x2', halfW + 5).attr('y2', H - 5)
                .attr('stroke', 'var(--border-light)')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '3,3');

            // Left panel: spatial view
            svg.append('text').attr('x', 15).attr('y', 12)
                .attr('fill', 'var(--text-muted)').attr('font-size', '9px').text('Spatial');

            svg.selectAll('.spt')
                .data(pts).enter()
                .append('circle')
                .attr('cx', d => xScaleS(d.sx))
                .attr('cy', d => yScaleS(d.sy))
                .attr('r', (d, i) => 2 + weights[i] * 5)
                .attr('fill', (d, i) => d3.interpolateRgb('#344570', '#e94560')(weights[i]))
                .attr('opacity', (d, i) => 0.3 + weights[i] * 0.7);

            svg.append('circle')
                .attr('cx', xScaleS(testPt.sx)).attr('cy', yScaleS(testPt.sy))
                .attr('r', 5).attr('fill', '#00e5ff').attr('stroke', '#fff').attr('stroke-width', 1.5);

            // Right panel: feature view (1D, y = feature value)
            svg.append('text').attr('x', halfW + 15).attr('y', 12)
                .attr('fill', 'var(--text-muted)').attr('font-size', '9px').text('Feature');

            svg.selectAll('.fpt')
                .data(pts).enter()
                .append('circle')
                .attr('cx', (d, i) => xScaleF(0.1 + Math.random() * 0.8)) // spread on x for visibility
                .attr('cy', d => yScaleS(d.fx))
                .attr('r', (d, i) => 2 + weights[i] * 5)
                .attr('fill', (d, i) => d3.interpolateRgb('#344570', '#e94560')(weights[i]))
                .attr('opacity', (d, i) => 0.3 + weights[i] * 0.7);

            svg.append('circle')
                .attr('cx', xScaleF(0.5)).attr('cy', yScaleS(testPt.fx))
                .attr('r', 5).attr('fill', '#00e5ff').attr('stroke', '#fff').attr('stroke-width', 1.5);
        }

        update(0.5);

        const slider = controls.querySelector('.demo-lambda-slider');
        const valSpan = controls.querySelector('.demo-lambda-val');
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            valSpan.textContent = v.toFixed(2);
            update(v);
        });
    });
}

export { initDrawer, openDrawer, closeDrawer };
