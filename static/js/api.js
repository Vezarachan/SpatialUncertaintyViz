// API client module
const API = {
    async getDatasets() {
        const r = await fetch('/api/datasets');
        return r.json();
    },
    async previewDataset(name) {
        const r = await fetch(`/api/datasets/${encodeURIComponent(name)}/preview`);
        return r.json();
    },
    async uploadDataset(file) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/datasets/upload', { method: 'POST', body: fd });
        return r.json();
    },
    async configureDataset(config) {
        const r = await fetch('/api/datasets/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        return r.json();
    },
    async getMetadata(name) {
        const r = await fetch(`/api/datasets/${encodeURIComponent(name)}/metadata`);
        return r.json();
    },
    async trainModel(config) {
        const r = await fetch('/api/model/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        return r.json();
    },
    async getMethods() {
        const r = await fetch('/api/analysis/methods');
        return r.json();
    },
    async runAnalysis(method, params) {
        const r = await fetch('/api/analysis/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params }),
        });
        return r.json();
    },
    async getStatus(jobId) {
        const r = await fetch(`/api/analysis/status/${jobId}`);
        return r.json();
    },
    async getResults(jobId) {
        const r = await fetch(`/api/analysis/results/${jobId}`);
        return r.json();
    },
};
export default API;
