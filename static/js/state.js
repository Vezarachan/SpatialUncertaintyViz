// Client-side state management
const State = {
    datasetName: null,
    datasetConfig: null,
    modelTrained: false,
    modelMetrics: null,
    selectedMethod: null,
    methodParams: {},
    results: null,
    selectedPointIndex: null,

    // Event listeners
    _listeners: {},
    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    },
    emit(event, data) {
        (this._listeners[event] || []).forEach(fn => fn(data));
    },

    setResults(results) {
        this.results = results;
        this.emit('results', results);
    },
    setSelectedPoint(index) {
        this.selectedPointIndex = index;
        this.emit('pointSelected', index);
    },
};
export default State;
