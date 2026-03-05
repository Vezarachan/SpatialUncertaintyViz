// Sidebar logic: dataset, model, method, and run panels
import API from './api.js';
import State from './state.js';

// Parameter definitions for CP method UI controls
const PARAM_DEFS = {
    alpha: { label: 'Miscoverage Level (\u03b1)', type: 'float', default: 0.1, min: 0.01, max: 0.5, step: 0.01 },
    bandwidth: { label: 'Bandwidth', type: 'float', default: 0.15, min: 0.01, max: 5.0, step: 0.01, isBandwidth: true },
    base_bandwidth: { label: 'Base Bandwidth', type: 'float', default: 0.15, min: 0.01, max: 5.0, step: 0.01, isBandwidth: true },
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
// Store native (meter/degree) bandwidth defaults for unit conversion
let nativeBandwidthDef = null;
// Current bandwidth display unit and conversion factor
// factor: multiply native value by factor to get display value
//   e.g. native=5000m, unit='km', factor=0.001 => display=5
let bwUnit = 'degrees';
let bwFactor = 1;

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
    currentCoordType = coordType;
    currentBandwidthSuggestion = suggestion;

    if (suggestion) {
        // Store native-unit values (always in original coordinate units)
        nativeBandwidthDef = { ...suggestion };
    } else {
        if (coordType === 'projected') {
            nativeBandwidthDef = { default: 5000, min: 100, max: 100000, step: 100 };
        } else {
            nativeBandwidthDef = { default: 0.15, min: 0.01, max: 5.0, step: 0.01 };
        }
    }

    // Choose default unit based on coordinate type and scale
    if (coordType === 'projected') {
        const diag = currentBandwidthSuggestion ? currentBandwidthSuggestion.max * 2 : 100000;
        // Default to km if extent > 50 km
        if (diag > 50000) {
            bwUnit = 'km';
            bwFactor = 0.001;
        } else {
            bwUnit = 'm';
            bwFactor = 1;
        }
    } else {
        bwUnit = 'degrees';
        bwFactor = 1;
    }

    // Apply unit conversion to PARAM_DEFS
    applyBandwidthUnit();

    console.log(`[Sidebar] Bandwidth: ${coordType}, unit=${bwUnit}, ` +
        `native default=${nativeBandwidthDef.default}, display default=${PARAM_DEFS.bandwidth.default}`);

    // If a method is already selected that uses bandwidth, re-render its params
    refreshMethodParamsIfNeeded();
}

function applyBandwidthUnit() {
    // Apply unit conversion factor to bandwidth PARAM_DEFS
    const nd = nativeBandwidthDef;
    const f = bwFactor;

    // Compute display values
    const dispDefault = roundSmart(nd.default * f);
    const dispMin = roundSmart(nd.min * f);
    const dispMax = roundSmart(nd.max * f);
    const dispStep = roundSmart(Math.max(nd.step * f, getMinStep(dispMax)));

    PARAM_DEFS.bandwidth.default = dispDefault;
    PARAM_DEFS.bandwidth.min = dispMin;
    PARAM_DEFS.bandwidth.max = dispMax;
    PARAM_DEFS.bandwidth.step = dispStep;
    PARAM_DEFS.base_bandwidth.default = dispDefault;
    PARAM_DEFS.base_bandwidth.min = dispMin;
    PARAM_DEFS.base_bandwidth.max = dispMax;
    PARAM_DEFS.base_bandwidth.step = dispStep;

    // Update labels
    const unitLabel = bwUnit === 'km' ? 'km' : bwUnit === 'm' ? 'm' : 'degrees';
    PARAM_DEFS.bandwidth.label = `Bandwidth (${unitLabel})`;
    PARAM_DEFS.base_bandwidth.label = `Base Bandwidth (${unitLabel})`;
}

function roundSmart(v) {
    // Round to reasonable precision
    if (Math.abs(v) >= 100) return Math.round(v);
    if (Math.abs(v) >= 1) return Math.round(v * 100) / 100;
    if (Math.abs(v) >= 0.01) return Math.round(v * 10000) / 10000;
    return v;
}

function getMinStep(maxVal) {
    // Get a reasonable minimum step size
    if (maxVal >= 1000) return 1;
    if (maxVal >= 100) return 0.1;
    if (maxVal >= 10) return 0.01;
    return 0.001;
}

function getAvailableUnits() {
    if (currentCoordType === 'projected') {
        return [
            { value: 'm', label: 'm', factor: 1 },
            { value: 'km', label: 'km', factor: 0.001 },
        ];
    }
    return [
        { value: 'degrees', label: 'degrees', factor: 1 },
    ];
}

function refreshMethodParamsIfNeeded() {
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

    // Coord type radio: show/hide EPSG input
    document.querySelectorAll('input[name="coord-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const epsgGroup = document.getElementById('epsg-group');
            if (radio.value === 'projected' && radio.checked) {
                epsgGroup.classList.remove('hidden');
            } else if (radio.value === 'geodetic' && radio.checked) {
                epsgGroup.classList.add('hidden');
            }
        });
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

    const summary = document.getElementById('dataset-summary');
    summary.innerHTML = `
        <strong>${State.datasetName}</strong><br>
        Rows: ${data.n_total || '?'} &nbsp;|&nbsp; Columns: ${columns.length}<br>
        <small style="color:var(--text-muted)">${columns.join(', ')}</small>
    `;

    populateSelect('target-select', numericCols, defaults.target);

    const defaultCoordX = defaults.coords ? defaults.coords[0] : autoDetectColumn(columns, 'x');
    const defaultCoordY = defaults.coords ? defaults.coords[1] : autoDetectColumn(columns, 'y');
    populateSelect('coord-x-select', columns, defaultCoordX);
    populateSelect('coord-y-select', columns, defaultCoordY);

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
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
    }

    // Set EPSG code if available
    const epsgInput = document.getElementById('epsg-code');
    if (defaults.epsg) {
        epsgInput.value = defaults.epsg;
    } else {
        epsgInput.value = '';
    }

    // Show/hide EPSG based on coord type
    const epsgGroup = document.getElementById('epsg-group');
    if (defaults.coord_type === 'projected') {
        epsgGroup.classList.remove('hidden');
    } else {
        epsgGroup.classList.add('hidden');
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
    const epsgVal = document.getElementById('epsg-code').value.trim();
    const epsg = epsgVal ? parseInt(epsgVal, 10) : null;

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

    const config = {
        dataset: State.datasetName,
        target,
        features,
        coords: [coordX, coordY],
        coord_type: coordType,
    };
    if (epsg) config.epsg = epsg;

    showStatus('configure-status', 'Configuring...', 'info');

    try {
        const result = await API.configureDataset(config);
        if (result.error) {
            showStatus('configure-status', result.error, 'error');
            return;
        }
        State.datasetConfig = config;

        // Update bandwidth params based on coordinate type and data extent
        // Use effective coord_type from server (may differ from user selection after auto-conversion)
        updateBandwidthParams(result.coord_type, result.bandwidth_suggestion);

        let statusMsg = `Configured: ${result.n_rows} rows, ${result.n_features} features. Y mean=${result.y_stats?.mean}`;
        if (result.auto_converted) {
            statusMsg += ' (Coords auto-converted to lon/lat)';
            // Update the UI to reflect the effective coord type
            const geoRadio = document.querySelector('input[name="coord-type"][value="geodetic"]');
            if (geoRadio) {
                geoRadio.checked = true;
                document.getElementById('epsg-group').classList.add('hidden');
            }
        }
        showStatus('configure-status', statusMsg, 'success');
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
        methodRegistry = data.methods || {};
        const defaults = data.defaults || {};
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

    const paramKeys = method.params || [];

    if (paramKeys.length > 0) {
        paramsSection.classList.remove('hidden');

        paramKeys.forEach(paramKey => {
            const def = PARAM_DEFS[paramKey];
            if (!def) return;

            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '10px';

            // Label row: label text + optional unit selector
            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;';

            const lbl = document.createElement('label');
            lbl.textContent = def.label;
            lbl.style.cssText = 'display:inline;margin:0;';
            labelRow.appendChild(lbl);

            // Add unit selector for bandwidth params with multiple unit options
            let unitSelect = null;
            const isBwParam = def.isBandwidth && currentCoordType === 'projected';
            if (isBwParam) {
                const units = getAvailableUnits();
                if (units.length > 1) {
                    unitSelect = document.createElement('select');
                    unitSelect.className = 'bw-unit-select';
                    units.forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = u.value;
                        opt.textContent = u.label;
                        if (u.value === bwUnit) opt.selected = true;
                        unitSelect.appendChild(opt);
                    });
                    labelRow.appendChild(unitSelect);
                }
            }

            wrapper.appendChild(labelRow);

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

            // For bandwidth params: store native value (convert display → native)
            const toNative = (displayVal) => {
                if (isBwParam) return displayVal / bwFactor;
                return displayVal;
            };

            // Sync slider → number input
            slider.addEventListener('input', () => {
                numInput.value = slider.value;
                const displayVal = parseFloat(slider.value);
                State.methodParams[paramKey] = def.type === 'float'
                    ? toNative(displayVal) : parseInt(slider.value, 10);
            });

            // Sync number input → slider
            numInput.addEventListener('change', () => {
                let v = parseFloat(numInput.value);
                if (isNaN(v)) v = def.default;
                v = Math.max(def.min, v);
                numInput.value = v;
                slider.value = Math.min(Math.max(v, def.min), def.max);
                State.methodParams[paramKey] = def.type === 'float' ? toNative(v) : Math.round(v);
            });

            // Unit selector change: rescale everything
            if (unitSelect) {
                unitSelect.addEventListener('change', () => {
                    const oldFactor = bwFactor;
                    const newUnit = unitSelect.value;
                    const units = getAvailableUnits();
                    const unitInfo = units.find(u => u.value === newUnit);
                    if (!unitInfo) return;

                    // Get current native value
                    const currentNative = State.methodParams[paramKey] || nativeBandwidthDef.default;

                    // Update global unit
                    bwUnit = newUnit;
                    bwFactor = unitInfo.factor;

                    // Recompute display PARAM_DEFS
                    applyBandwidthUnit();
                    const newDef = PARAM_DEFS[paramKey];

                    // Update slider range
                    slider.min = newDef.min;
                    slider.max = newDef.max;
                    slider.step = newDef.step;
                    numInput.min = newDef.min;
                    numInput.max = newDef.max;
                    numInput.step = newDef.step;

                    // Convert current value to new display unit
                    const newDisplayVal = roundSmart(currentNative * bwFactor);
                    slider.value = Math.min(Math.max(newDisplayVal, newDef.min), newDef.max);
                    numInput.value = newDisplayVal;

                    // Update label
                    lbl.textContent = newDef.label;

                    // Native value stays the same
                    State.methodParams[paramKey] = currentNative;
                });
            }

            row.appendChild(slider);
            row.appendChild(numInput);
            wrapper.appendChild(row);

            // Initialize state with native value
            const displayDefault = parseFloat(def.default);
            State.methodParams[paramKey] = def.type === 'float'
                ? toNative(displayDefault) : parseInt(def.default, 10);

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

            if (statusResp.status === 'done') {
                progressFill.style.width = '100%';
                statusText.textContent = 'Complete! Loading results...';
                const resultResp = await API.getResults(jobId);
                if (resultResp.error) {
                    statusText.textContent = 'Error: ' + resultResp.error;
                    return;
                }
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
