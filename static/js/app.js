// Main application initialization
import API from './api.js';
import State from './state.js';
import { initSidebar } from './sidebar.js';
import { initMap } from './mapView.js';
import { initCharts } from './charts.js';
import { initDrawer } from './methodDrawer.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Init panel accordion
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', () => {
            const panelName = header.dataset.panel;
            const body = document.getElementById(`panel-body-${panelName}`);
            const toggle = header.querySelector('.panel-toggle');
            body.classList.toggle('open');
            toggle.textContent = body.classList.contains('open') ? '\u25BC' : '\u25B6';
        });
    });

    // Init modules
    await initSidebar();
    initMap();
    initCharts();
    initDrawer();
});
