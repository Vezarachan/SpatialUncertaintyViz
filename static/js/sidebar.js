// Sidebar logic: dataset, model, method, and run panels
import API from './api.js';
import State from './state.js';

// Parameter definitions for CP method UI controls
const PARAM_DEFS = {
    alpha: { label: 'Miscoverage Level (\u03b1)', type: 'float', default: 0.1, min: 0.01, max: 0.5, step: 0.01 },
    bandwidth: { label: 'Bandwidth', type: 'float', default: 0.15, min: 0.01, max: 5.0, step: 0.01 },
    base_bandwidth: { label: 'Base Bandwidth', type: 'float', default: 0.15, min: 0.01, max: 5.0, step: 0.01 },
    beta: { label: 'Prior Strength (\u03b2)', type: 'float', default: 0.9, min: 0.01, max: 0.99, step: 0.01 },
    num_mc: { label: 'MC Samples', type: 'int', default: 1000, min: 100, max: 10000, step: 100 },
    k: { label: 'k (Neighbors)', type: 'int', default: 20, min: 5, max: 500, step: 5 },
    k_adaptive: { label: 'k (Adaptive)', type: 'int', default: 200, min: 10, max: 1000, step: 10 },
    lambda_weight: { label: '\u03bb (Spatial Weight)', type: 'float', default: 0.5, min: 0.0, max: 1.0, step: 0.05 },
    n_jobs: { label: 'Parallel Jobs', type: 'int', default: 4, min: 1, max: 8, step: 1 },
};

// Cache
let previewData = null;
let methodRegistry = {};
let datasetList = [];
// Store coordinate info from configure response for bandwidth scaling
let currentCoordType = 'geodetic';
let currentBandwidthSuggestion = null;

// ============================================================
// Initialization
// ============================================================
async function initSidebar() {
    await loadDatasets();
    await loadMethods();
    bindDatasetEvents();
    bindModelEvents();
    bindRunEvents();
}

// ============================================================
// Bandwidth scaling based on coordinate type
// ============================================================
function updateBandwidthParams(coordType, suggestion) {
    /**
     * Update PARAM_DEFS for bandwidth and base_bandwidth based on
     * coordinate type and backend-computed suggestion.
     * - geodetic (lon/lat): small values in degrees
     * - projected (UTM, etc.): large values in meters
     */
    currentCoordType = coordType;
    currentBandwidthSuggestion = suggestion;

    if (suggestion) {
        // Use server-computed suggestion based on actual data extent
        const bw = suggestion;
        PARAM_DEFS.bandwidth.default = bw.default;
        PARAM_DEFS.bandwidth.min = bw.min;
        PARAM_DEFS.bandwidth.max = bw.max;
        PARAM_DEFS.bandwidth.step = bw.step;
        // base_bandwidth uses same scale
        PARAM_DEFS.base_bandwidth.default = bw.default;
        PARAM_DEFS.base_bandwidth.min = bw.min;
        PARAM_DEFS.base_bandwidth.max = bw.max;
        PARAM_DEFS.base_bandwidth.step = bw.step;
    } else {
        // Fallback heuristic when no suggestion available
        if (coordType === 'projected') {
            PARAM_DEFS.bandwidth.default = 5000;
            PARAM_DEFS.bandwidth.min = 100;
            PARAM_DEFS.bandwidth.max = 100000;
            PARAM_DEFS.bandwidth.step = 100;
            PARAM_DEFS.base_bandwidth.default = 5000;
            PARAM_DEFS.base_bandwidth.min = 100;
            PARAM_DEFS.base_bandwidth.max = 100000;
            PARAM_DEFS.base_bandwidth.step = 100;
        } else {
            // geodetic defaults
            PARAM_DEFS.bandwidth.default = 0.15;
            PARAM_DEFS.bandwidth.min = 0.01;
            PARAM_DEFS.bandwidth.max = 5.0;
            PARAM_DEFS.bandwidth.step = 0.01;
            PARAM_DEFS.base_bandwidth.default = 0.15;
            PARAM_DEFS.base_bandwidth.min = 0.01;
            PARAM_DEFS.base_bandwidth.max = 5.0;
            PARAM_DEFS.base_bandwidth.step = 0.01;
        }
    }

    // Update label to show units
    const unit = coordType === 'projected' ? ' (meters)' : ' (degrees)';
    PARAM_DEFS.bandwidth.label = 'Bandwidth' + unit;
    PARAM_DEFS.base_bandwidth.label = 'Base Bandwidth' + unit;

    console.log(`[Sidebar] Bandwidth params updated for ${coordType}:`,
        `default=${PARAM_DEFS.bandwidth.default}, range=[${PARAM_DEFS.bandwidth.min}, ${PARAM_DEFS.bandwidth.max}]`);

    // If a method is already selected that uses bandwidth, re-render its params
    refreshMethodParamsIfNeeded();
}

function refreshMethodParamsIfNeeded() {
    /**
     * If a CP method is currently selected and it uses bandwidth/base_bandwidth,
     * re-render the param sliders with updated PARAM_DEFS.
     */
    if (!State.selectedMethod) return;
    const methodInfo = methodRegistry[State.selectedMethod];
    if (!methodInfo) return;
    const paramKeys = methodInfo.params || [];
    if (paramKeys.includes('bandwidth') || paramKeys.includes('base_bandwidth')) {
        handleMethodSelect({ key: State.selectedMethod, ...methodInfo });
    }
}

// ============================================================
// Dataset Panel
// ============================================================
async function loadDatasets() {
    try {
        const data = await API.getDatasets();
        // API returns {datasets: [{name, builtin, rows, columns, description, config}, ...]}
        datasetList = data.datasets || [];
        const select = document.getElementById('dataset-select');
        select.innerHTML = '<option value="">-- Choose a dataset --</option>';

        const builtins = datasetList.filter(d => d.builtin);
        const uploaded = datasetList.filter(d => !d.builtin);

        if (builtins.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Built-in Datasets';
            builtins.forEach(ds => {
                const opt = document.createElement('option');
                opt.value = ds.name;
                opt.textContent = ds.description || ds.name;
                group.appendChild(opt);
            });
            select.appendChild(group);
        }
        if (uploaded.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Uploaded Datasets';
            uploaded.forEach(ds => {
                const opt = document.createElement('option');
                opt.value = ds.name;
                opt.textContent = ds.name;
                group.appendChild(opt);
            });
            select.appendChild(group);
        }
    } catch (err) {
        console.warn('Failed to load datasets:', err);
    }
}

function bindDatasetEvents() {
    const dsSelect = document.getElementById('dataset-select');
    dsSelect.addEventListener('change', async () => {
        const name = dsSelect.value;
        if (!name) {
            document.getElementById('dataset-info').classList.add('hidden');
            return;
        }
        await handleDatasetSelected(name);
    });

    // File upload
    const fileInput = document.getElementById('file-upload');
    fileInput.addEventListener('change', async () => {
        if (fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        showStatus('configure-status', 'Uploading...', 'info');
        try {
            const result = await API.uploadDataset(file);
            if (result.error) {
                showStatus('configure-status', result.error, 'error');
                return;
            }
            await loadDatasets();
            dsSelect.value = result.name;
            await handleDatasetSelected(result.name);
            showStatus('configure-status', 'File uploaded successfully.', 'success');
        } catch (err) {
            showStatus('configure-status', 'Upload failed: ' + err.message, 'error');
        }
    });

    document.getElementById('btn-configure').addEventListener('click', handleConfigure);
}

async function handleDatasetSelected(name) {
    State.datasetName = name;
    State.datasetConfig = null;
    State.modelTrained = false;
    updateButtonStates();

    try {
        // Preview API returns: {columns, numeric_columns, dtypes, rows, n_total, coord_detection, default_config?}
        previewData = await API.previewDataset(name);
        if (previewData.error) {
            showStatus('configure-status', previewData.error, 'error');
            return;
        }
        populateDatasetInfo(previewData);
        document.getElementById('dataset-info').classList.remove('hidden');
        hideStatus('configure-status');
    } catch (err) {
        showStatus('configure-status', 'Failed to load preview: ' + err.message, 'error');
    }
}

function populateDatasetInfo(data) {
    const columns = data.columns || [];
    const numericCols = data.numeric_columns || columns;
    const defaults = data.default_config || {};

    // Summary
    const summary = document.getElementById('dataset-summary');
    summary.innerHTML = `
        <strong>${State.datasetName}</strong><br>
        Rows: ${data.n_total || '?'} &nbsp;|&nbsp; Columns: ${columns.length}<br>
        <small style="color:var(--text-muted)">${columns.join(', ')}</small>
    `;

    // Populate target select (only numeric columns)
    populateSelect('target-select', numericCols, defaults.target);

    // Coordinate selects: defaults.coords is [x_col, y_col] array
    const defaultCoordX = defaults.coords ? defaults.coords[0] : autoDetectColumn(columns, 'x');
    const defaultCoordY = defaults.coords ? defaults.coords[1] : autoDetectColumn(columns, 'y');
    populateSelect('coord-x-select', columns, defaultCoordX);
    populateSelect('coord-y-select', columns, defaultCoordY);

    // Feature checkboxes
    const featureContainer = document.getElementById('feature-checkboxes');
    featureContainer.innerHTML = '';
    const defaultFeatures = defaults.features || [];
    numericCols.forEach(col => {
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = col;
        cb.name = 'feature-vars';
        if (defaultFeatures.length > 0) {
            cb.checked = defaultFeatures.includes(col);
        } else {
            const target = document.getElementById('target-select').value;
            cb.checked = col !== target && col !== defaultCoordX && col !== defaultCoordY;
        }
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + col));
        featureContainer.appendChild(lbl);
    });

    // Set coordinate type
    if (defaults.coord_type) {
        const radio = document.querySelector(`input[name="coord-type"][value="${defaults.coord_type}"]`);
        if (radio) radio.checked = true;
    }
}

function autoDetectColumn(columns, axis) {
    const patterns = axis === 'x'
        ? ['longitude', 'lon', 'lng', 'long', 'x', 'coord_x', 'easting', 'utm_x', 'proj_x']
        : ['latitude', 'lat', 'y', 'coord_y', 'northing', 'utm_y', 'proj_y'];
    const lower = columns.map(c => c.toLowerCase());
    for (const pat of patterns) {
        const idx = lower.findIndex(c => c === pat || c.includes(pat));
        if (idx !== -1) return columns[idx];
    }
    return '';
}

function populateSelect(selectId, options, defaultVal) {
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">-- select --</option>';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === defaultVal) o.selected = true;
        select.appendChild(o);
    });
}

async function handleConfigure() {
    const target = document.getElementById('target-select').value;
    const coordX = document.getElementById('coord-x-select').value;
    const coordY = document.getElementById('coord-y-select').value;
    const coordType = document.querySelector('input[name="coord-type"]:checked').value;

    const featureCBs = document.querySelectorAll('input[name="feature-vars"]:checked');
    const features = Array.from(featureCBs).map(cb => cb.value);

    if (!target) {
        showStatus('configure-status', 'Please select a target variable.', 'error');
        return;
    }
    if (!coordX || !coordY) {
        showStatus('configure-status', 'Please select coordinate columns.', 'error');
        return;
    }
    if (features.length === 0) {
        showStatus('configure-status', 'Please select at least one feature.', 'error');
        return;
    }

    // Backend expects coords as [x_col, y_col] array
    const config = {
        dataset: State.datasetName,
        target,
        features,
        coords: [coordX, coordY],
        coord_type: coordType,
    };

    showStatus('configure-status', 'Configuring...', 'info');

    try {
        const result = await API.configureDataset(config);
        if (result.error) {
            showStatus('configure-status', result.error, 'error');
            return;
        }
        State.datasetConfig = config;

        // Update bandwidth params based on coordinate type and data extent
        updateBandwidthParams(result.coord_type, result.bandwidth_suggestion);

        showStatus('configure-status',
            `Configured: ${result.n_rows} rows, ${result.n_features} features. Y mean=${result.y_stats?.mean}`,
            'success');
        document.getElementById('btn-train').disabled = false;
        updateButtonStates();
        openPanel('model');
    } catch (err) {
        showStatus('configure-status', 'Configuration failed: ' + err.message, 'error');
    }
}

// ============================================================
// Model Panel
// ============================================================
function bindModelEvents() {
    document.querySelectorAll('input[name="model-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            document.getElementById('params-rf').classList.add('hidden');
            document.getElementById('params-xgb').classList.add('hidden');
            const val = radio.value;
            if (val === 'random_forest') {
                document.getElementById('params-rf').classList.remove('hidden');
            } else if (val === 'xgboost') {
                document.getElementById('params-xgb').classList.remove('hidden');
            }
        });
    });

    bindSlider('rf-n-estimators', 'rf-n-val');
    bindSlider('rf-max-depth', 'rf-depth-val');
    bindSlider('xgb-n-estimators', 'xgb-n-val');
    bindSlider('xgb-learning-rate', 'xgb-lr-val');
    bindSlider('xgb-max-depth', 'xgb-depth-val');
    bindSlider('train-ratio', 'split-val');

    document.getElementById('btn-train').addEventListener('click', handleTrain);
}

function bindSlider(sliderId, displayId) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', () => {
        display.textContent = slider.value;
    });
}

async function handleTrain() {
    const modelType = document.querySelector('input[name="model-type"]:checked').value;
    const trainRatio = parseFloat(document.getElementById('train-ratio').value);
    const seed = parseInt(document.getElementById('random-seed').value, 10);

    // Backend expects model-specific params under 'model_params'
    const modelParams = {};
    if (modelType === 'random_forest') {
        modelParams.n_estimators = parseInt(document.getElementById('rf-n-estimators').value, 10);
        modelParams.max_depth = parseInt(document.getElementById('rf-max-depth').value, 10);
    } else if (modelType === 'xgboost') {
        modelParams.n_estimators = parseInt(document.getElementById('xgb-n-estimators').value, 10);
        modelParams.learning_rate = parseFloat(document.getElementById('xgb-learning-rate').value);
        modelParams.max_depth = parseInt(document.getElementById('xgb-max-depth').value, 10);
    }

    const config = {
        model_type: modelType,
        train_ratio: trainRatio,
        random_seed: seed,
        model_params: modelParams,
    };

    showStatus('train-status', 'Training model...', 'info');
    document.getElementById('btn-train').disabled = true;
    document.getElementById('metrics-card').classList.add('hidden');

    try {
        const result = await API.trainModel(config);
        if (result.error) {
            showStatus('train-status', result.error, 'error');
            document.getElementById('btn-train').disabled = false;
            return;
        }
        State.modelTrained = true;
        State.modelMetrics = result.metrics;
        showStatus('train-status',
            `${result.model_name} trained. Train=${result.n_train}, Calib=${result.n_calib}, Test=${result.n_test}`,
            'success');
        displayMetrics(result.metrics, result);
        document.getElementById('btn-train').disabled = false;
        updateButtonStates();
        openPanel('method');
    } catch (err) {
        showStatus('train-status', 'Training failed: ' + err.message, 'error');
        document.getElementById('btn-train').disabled = false;
    }
}

function displayMetrics(metrics, trainResult) {
    const card = document.getElementById('metrics-card');
    card.classList.remove('hidden');
    let html = `<strong>${trainResult?.model_name || 'Model'} Metrics</strong><br>`;
    const entries = [
        ['R\u00b2', metrics.r2],
        ['RMSE', metrics.rmse],
        ['MAE', metrics.mae],
    ];
    entries.forEach(([label, val]) => {
        if (val !== undefined) {
            html += `<div class="metric-row"><span>${label}</span><span class="metric-value">${val.toFixed(4)}</span></div>`;
        }
    });
    if (trainResult) {
        html += `<div class="metric-row"><span>Train / Calib / Test</span><span class="metric-value">${trainResult.n_train} / ${trainResult.n_calib} / ${trainResult.n_test}</span></div>`;
    }
    card.innerHTML = html;
}

// ============================================================
// CP Method Panel
// ============================================================
async function loadMethods() {
    try {
        const data = await API.getMethods();
        // API returns {methods: {key: {label, group, bayesian, params: [strings], ...}}, defaults: {...}}
        methodRegistry = data.methods || {};
        const defaults = data.defaults || {};
        // Merge defaults into PARAM_DEFS (only for non-bandwidth params,
        // bandwidth is managed dynamically by updateBandwidthParams)
        Object.entries(defaults).forEach(([k, v]) => {
            if (PARAM_DEFS[k] && k !== 'bandwidth' && k !== 'base_bandwidth') {
                PARAM_DEFS[k].default = v;
            }
        });
        renderMethodGroups(methodRegistry);
    } catch (err) {
        console.warn('Failed to load methods:', err);
    }
}

function renderMethodGroups(methods) {
    const container = document.getElementById('method-groups');
    container.innerHTML = '';

    // Group methods by their 'group' field
    const groups = {};
    Object.entries(methods).forEach(([key, info]) => {
        const groupName = info.group || 'Other';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push({ key, ...info });
    });

    Object.entries(groups).forEach(([groupName, methodList]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'method-group';

        const title = document.createElement('div');
        title.className = 'method-group-title';
        title.textContent = groupName;
        groupDiv.appendChild(title);

        const radioGroup = document.createElement('div');
        radioGroup.className = 'radio-group';

        methodList.forEach(method => {
            const lbl = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'cp-method';
            radio.value = method.key;
            radio.addEventListener('change', () => handleMethodSelect(method));

            lbl.appendChild(radio);
            lbl.appendChild(document.createTextNode(' ' + method.label));

            // Show badges
            const badges = [];
            if (method.bayesian) badges.push('Bayesian');
            if (method.is_async) badges.push('Async');
            if (badges.length > 0) {
                const badge = document.createElement('small');
                badge.style.cssText = 'margin-left:6px;color:var(--accent);font-size:9px;';
                badge.textContent = `[${badges.join(', ')}]`;
                lbl.appendChild(badge);
            }

            radioGroup.appendChild(lbl);
        });

        groupDiv.appendChild(radioGroup);
        container.appendChild(groupDiv);
    });
}

function handleMethodSelect(method) {
    State.selectedMethod = method.key;
    State.methodParams = {};

    const paramsSection = document.getElementById('method-params');
    const controlsContainer = document.getElementById('param-controls');
    controlsContainer.innerHTML = '';

    // method.params is an array of param key strings like ["alpha", "bandwidth"]
    const paramKeys = method.params || [];

    if (paramKeys.length > 0) {
        paramsSection.classList.remove('hidden');

        paramKeys.forEach(paramKey => {
            const def = PARAM_DEFS[paramKey];
            if (!def) return;

            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '10px';

            // Label
            const lbl = document.createElement('label');
            lbl.textContent = def.label;
            lbl.style.display = 'block';
            lbl.style.marginBottom = '2px';
            wrapper.appendChild(lbl);

            // Slider + number input row
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = def.min;
            slider.max = def.max;
            slider.step = def.step;
            slider.value = def.default;
            slider.style.flex = '1';

            const numInput = document.createElement('input');
            numInput.type = 'number';
            numInput.min = def.min;
            numInput.max = def.max;
            numInput.step = def.step;
            numInput.value = def.default;
            numInput.className = 'param-number-input';

            // Sync slider → number input
            slider.addEventListener('input', () => {
                numInput.value = slider.value;
                State.methodParams[paramKey] = def.type === 'float'
                    ? parseFloat(slider.value) : parseInt(slider.value, 10);
            });

            // Sync number input → slider (allow values outside slider range for flexibility)
            numInput.addEventListener('change', () => {
                let v = parseFloat(numInput.value);
                if (isNaN(v)) v = def.default;
                // Clamp to min but allow exceeding slider max for manual precision
                v = Math.max(def.min, v);
                numInput.value = v;
                // Update slider (will clamp to slider range visually)
                slider.value = Math.min(Math.max(v, def.min), def.max);
                State.methodParams[paramKey] = def.type === 'float' ? v : Math.round(v);
            });

            row.appendChild(slider);
            row.appendChild(numInput);
            wrapper.appendChild(row);

            State.methodParams[paramKey] = def.type === 'float'
                ? parseFloat(def.default) : parseInt(def.default, 10);

            controlsContainer.appendChild(wrapper);
        });
    } else {
        paramsSection.classList.add('hidden');
    }

    updateButtonStates();
}

// ============================================================
// Run Panel
// ============================================================
function bindRunEvents() {
    document.getElementById('btn-run').addEventListener('click', handleRun);
}

async function handleRun() {
    if (!State.selectedMethod) {
        showStatus('run-status-text', 'Please select a CP method.', 'error');
        return;
    }

    const btnRun = document.getElementById('btn-run');
    const progressDiv = document.getElementById('run-progress');
    const progressFill = document.getElementById('progress-fill');
    const statusText = document.getElementById('run-status-text');
    const resultSummary = document.getElementById('result-summary');

    btnRun.disabled = true;
    progressDiv.classList.remove('hidden');
    resultSummary.classList.add('hidden');
    progressFill.style.width = '10%';
    statusText.textContent = 'Submitting analysis...';

    try {
        // Run endpoint always returns {job_id}
        const response = await API.runAnalysis(State.selectedMethod, State.methodParams);
        if (response.error) {
            statusText.textContent = response.error;
            btnRun.disabled = false;
            progressFill.style.width = '0%';
            return;
        }

        const jobId = response.job_id;
        await pollJob(jobId, progressFill, statusText);
        btnRun.disabled = false;
    } catch (err) {
        statusText.textContent = 'Error: ' + err.message;
        btnRun.disabled = false;
        progressFill.style.width = '0%';
    }
}

async function pollJob(jobId, progressFill, statusText) {
    const maxAttempts = 300;
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(500);
        try {
            const statusResp = await API.getStatus(jobId);

            if (statusResp.progress !== undefined) {
                progressFill.style.width = Math.round(statusResp.progress) + '%';
            }

            // Backend returns status: "done" | "running" | "error"
            if (statusResp.status === 'done') {
                progressFill.style.width = '100%';
                statusText.textContent = 'Complete! Loading results...';
                const resultResp = await API.getResults(jobId);
                if (resultResp.error) {
                    statusText.textContent = 'Error: ' + resultResp.error;
                    return;
                }
                // Results endpoint returns {status: "done", result: {...}}
                if (!resultResp.result) {
                    console.error('No result in response:', resultResp);
                    statusText.textContent = 'Error: empty result from server';
                    return;
                }
                try {
                    handleResults(resultResp.result);
                } catch (renderErr) {
                    console.error('Result rendering error:', renderErr);
                    statusText.textContent = 'Render error: ' + renderErr.message;
                }
                statusText.textContent = 'Analysis complete.';
                return;
            } else if (statusResp.status === 'error') {
                statusText.textContent = 'Failed: ' + (statusResp.error || 'Unknown error');
                progressFill.style.width = '0%';
                return;
            } else {
                statusText.textContent = 'Running analysis...';
            }
        } catch (err) {
            console.error('Polling error:', err);
            statusText.textContent = 'Polling error: ' + err.message;
            return;
        }
    }
    statusText.textContent = 'Timeout: analysis took too long.';
}

function handleResults(result) {
    // result = {method, method_label, is_bayesian, summary: {...}, per_point: {...}}
    State.setResults(result);

    const summaryCard = document.getElementById('result-summary');
    summaryCard.classList.remove('hidden');

    const s = result.summary || {};
    const coveragePct = s.coverage !== undefined ? (s.coverage * 100).toFixed(1) + '%' : 'N/A';
    const targetPct = s.target_coverage !== undefined ? (s.target_coverage * 100).toFixed(1) + '%' : 'N/A';

    let html = `<strong>${result.method_label || result.method}</strong>`;
    html += `<div class="metric-row"><span>Coverage</span><span class="metric-value">${coveragePct}</span></div>`;
    html += `<div class="metric-row"><span>Target</span><span class="metric-value">${targetPct}</span></div>`;
    html += `<div class="metric-row"><span>Mean Width</span><span class="metric-value">${s.mean_width !== undefined ? s.mean_width.toFixed(4) : 'N/A'}</span></div>`;
    html += `<div class="metric-row"><span>Global Uncertainty</span><span class="metric-value">${s.global_uncertainty !== undefined ? s.global_uncertainty.toFixed(4) : 'N/A'}</span></div>`;
    html += `<div class="metric-row"><span>Test Points</span><span class="metric-value">${s.n_test || 'N/A'}</span></div>`;

    if (result.is_bayesian) {
        if (s.mean_n_eff !== undefined)
            html += `<div class="metric-row"><span>Mean N_eff</span><span class="metric-value">${s.mean_n_eff.toFixed(1)}</span></div>`;
        if (s.beta !== undefined)
            html += `<div class="metric-row"><span>\u03b2</span><span class="metric-value">${s.beta}</span></div>`;
    }

    summaryCard.innerHTML = html;
}

// ============================================================
// Helpers
// ============================================================
function updateButtonStates() {
    const trainBtn = document.getElementById('btn-train');
    const runBtn = document.getElementById('btn-run');
    trainBtn.disabled = !State.datasetConfig;
    runBtn.disabled = !(State.modelTrained && State.selectedMethod);
}

function openPanel(panelName) {
    const body = document.getElementById(`panel-body-${panelName}`);
    const header = document.querySelector(`.panel-header[data-panel="${panelName}"]`);
    if (body && !body.classList.contains('open')) {
        body.classList.add('open');
        const toggle = header?.querySelector('.panel-toggle');
        if (toggle) toggle.textContent = '\u25BC';
    }
}

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `status-msg ${type}`;
    el.classList.remove('hidden');
}

function hideStatus(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.classList.add('hidden');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { initSidebar };
