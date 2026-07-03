/**
 * Main application logic for ISRO PS14 GeoSat Radiation Forecast Console.
 * Handles API fetching, UI updates, and Chart.js rendering.
 */

const API_BASE_URL = 'http://localhost:8000/api/v1';

// Chart instances
let forecastChart = null;
let vswChart = null;
let bzChart = null;
let npChart = null;

// UI Elements
const ui = {
    clock: document.getElementById('mission-clock'),
    doy: document.getElementById('doy-clock'),
    statusIndicator: document.getElementById('system-status-indicator'),
    apiStatus: document.getElementById('api-status'),
    staleBanner: document.getElementById('stale-banner'),
    
    currentFlux: document.getElementById('current-flux-value'),
    advCurrentFlux: document.getElementById('adv-current-flux'),
    advRatio: document.getElementById('adv-ratio'),
    obsSamples: document.getElementById('obs-samples-value'),
    
    advisoryIcon: document.getElementById('advisory-icon'),
    advisoryLevelText: document.getElementById('advisory-level-text'),
    advisoryDescText: document.getElementById('advisory-desc-text'),
    advisoryUpdatedTime: document.getElementById('advisory-updated-time'),
    
    vswVal: document.getElementById('vsw-val'),
    bzVal: document.getElementById('bz-val'),
    npVal: document.getElementById('np-val'),
    
    footerLastFetch: document.getElementById('footer-last-fetch'),
    
    horizonTabs: document.querySelectorAll('.horizon-tab'),
    
    // New Hackathon Features
    kpIndex: document.getElementById('kp-index-value'),
    exportBtn: document.getElementById('btn-export-csv'),
    stormPicker: document.getElementById('storm-picker'),
    bzSlider: document.getElementById('bz-slider'),
    simStatus: document.getElementById('sim-status'),
    
    // Audio and upload selectors
    audioToggle: document.getElementById('btn-audio-toggle'),
    audioToggleText: document.getElementById('audio-toggle-text'),
    fileInput: document.getElementById('file-input'),
    dropZone: document.getElementById('drop-zone')
};

// Application State
let currentState = {
    horizon: 6, // 30 mins (6 * 5min)
    thresholds: {
        elevated: 1e3,
        severe: 1e4
    },
    isLive: false,
    lastUpdate: null,
    
    // Hackathon Features State
    activeStorm: null,
    simBzOffset: 0,
    audioMuted: false,
    lastAudioAlertTime: 0,
    customIngestedData: null
};

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    setupEventListeners();
    startClocks();
    
    // Initial fetch
    fetchDashboardData();
    
    // Auto-refresh every 1 minute for a balanced demo pace
    setInterval(fetchDashboardData, 60000);
    
    // Start dynamic telemetry log streamer
    startTelemetryLogStreamer();
});

function setupEventListeners() {
    ui.horizonTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            ui.horizonTabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentState.horizon = parseInt(e.target.dataset.horizon);
            fetchDashboardData();
        });
    });

    // Storm Picker
    if (ui.stormPicker) {
        ui.stormPicker.addEventListener('change', (e) => {
            currentState.customIngestedData = null; // Clear manual upload
            
            // Restore normal badge color
            if (ui.apiStatus) {
                ui.apiStatus.className = 'link-badgeDisconnected';
                setApiStatus(false);
            }
            
            currentState.activeStorm = e.target.value;
            fetchDashboardData(); // Refetch to get new "historical" data
        });
    }

    // Export CSV
    if (ui.exportBtn) {
        ui.exportBtn.addEventListener('click', () => {
            const data = forecastChart.data;
            let csvContent = "data:text/csv;charset=utf-8,Time,Observed_LogFlux,Forecast_LogFlux\n";
            
            for (let i = 0; i < data.labels.length; i++) {
                const time = data.labels[i];
                const obs = data.datasets[0].data[i] || "";
                const pred = data.datasets[1].data[i] || "";
                csvContent += `${time},${obs},${pred}\n`;
            }
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `forecast_export_${currentState.horizon}steps.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    // What If Simulator (Bz Slider)
    if (ui.bzSlider) {
        ui.bzSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            currentState.simBzOffset = val;
            
            if (val !== 0) {
                ui.simStatus.textContent = `ACTIVE (Bz ${val > 0 ? '+' : ''}${val}nT)`;
                ui.simStatus.className = 'sim-status active';
            } else {
                ui.simStatus.textContent = 'OFF';
                ui.simStatus.className = 'sim-status';
            }
            
            // Instantly regenerate data using the simulator offset
            if (currentState.customIngestedData) {
                updateDashboardUI(currentState.customIngestedData);
            } else {
                updateDashboardUI(generateMockData());
            }
        });
    }
    
    // Audio Alarm Toggle
    if (ui.audioToggle) {
        ui.audioToggle.addEventListener('click', () => {
            currentState.audioMuted = !currentState.audioMuted;
            if (currentState.audioMuted) {
                ui.audioToggleText.textContent = "MUTED";
                ui.audioToggle.style.color = "var(--text-dim)";
                ui.audioToggle.style.borderColor = "var(--border-subtle)";
            } else {
                ui.audioToggleText.textContent = "UNMUTED";
                ui.audioToggle.style.color = "var(--amber)";
                ui.audioToggle.style.borderColor = "rgba(255,171,0,0.3)";
            }
        });
    }

    // Dataset Drag and Drop Ingest
    if (ui.dropZone && ui.fileInput) {
        ui.dropZone.addEventListener('click', () => {
            ui.fileInput.click();
        });
        
        ui.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleIngestedFile(e.target.files[0]);
            }
        });
        
        ui.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            ui.dropZone.style.background = 'rgba(0, 229, 255, 0.1)';
            ui.dropZone.style.borderColor = 'var(--cyan)';
        });
        
        ui.dropZone.addEventListener('dragleave', () => {
            ui.dropZone.style.background = 'transparent';
            ui.dropZone.style.borderColor = 'var(--border-panel-accent)';
        });
        
        ui.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            ui.dropZone.style.background = 'transparent';
            ui.dropZone.style.borderColor = 'var(--border-panel-accent)';
            if (e.dataTransfer.files.length > 0) {
                handleIngestedFile(e.dataTransfer.files[0]);
            }
        });
    }
}

// ============================================================
// Time & Clocks
// ============================================================

function startClocks() {
    function updateClock() {
        const now = new Date();
        
        // Format YYYY-MM-DD HH:MM:SS UTC
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');
        
        ui.clock.textContent = `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
        
        // Calculate DOY
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
        const diff = now - start;
        const oneDay = 1000 * 60 * 60 * 24;
        const doy = Math.floor(diff / oneDay);
        ui.doy.textContent = String(doy).padStart(3, '0');
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

function flashValue(element) {
    element.classList.remove('value-flash');
    void element.offsetWidth; // Trigger reflow
    element.classList.add('value-flash');
}

// ============================================================
// API Fetching
// ============================================================

async function fetchDashboardData() {
    if (currentState.customIngestedData) {
        // Skip API fetching if manual dataset is uploaded
        return;
    }
    try {
        // NOTE: During backend training, API might be down or not return live data yet.
        // For demonstration, we'll try to fetch, and if it fails, we fall back to mock data
        // to keep the frontend looking good until the backend is fully wired up.
        
        const response = await fetch(`${API_BASE_URL}/forecast/live`);
        
        if (!response.ok) throw new Error('API Error');
        
        const data = await response.json();
        updateDashboardUI(data);
        setApiStatus(true);
        
    } catch (error) {
        console.warn('Backend not available yet, using mock data for frontend demo...', error);
        setApiStatus(false);
        updateDashboardUI(generateMockData());
    }
}

function setApiStatus(isOk) {
    if (isOk) {
        ui.apiStatus.className = 'link-badge';
        ui.apiStatus.innerHTML = '<div class="dot"></div> LINK OK';
    } else {
        ui.apiStatus.className = 'link-badge disconnected';
        ui.apiStatus.innerHTML = '<div class="dot"></div> DEMO MODE';
    }
}

// ============================================================
// UI Updates
// ============================================================

function updateDashboardUI(data) {
    const now = new Date();
    currentState.lastUpdate = now;
    ui.footerLastFetch.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
    
    // Update Metrics
    const currentFluxVal = data.current_conditions.electron_flux_gt2MeV;
    
    // Format scientific notation
    const formattedFlux = currentFluxVal.toExponential(2).replace('e+', 'e+');
    
    ui.currentFlux.textContent = formattedFlux;
    ui.advCurrentFlux.textContent = formattedFlux;
    flashValue(ui.currentFlux);
    flashValue(ui.advCurrentFlux);
    
    // Ratio
    const ratio = (currentFluxVal / currentState.thresholds.elevated).toFixed(2);
    ui.advRatio.textContent = ratio;
    
    // Update Advisory
    updateAdvisoryPanel(currentFluxVal);
    
    // Update Solar Wind Drivers
    ui.vswVal.textContent = data.current_conditions.Vsw.toFixed(1);
    
    // Apply simulator offset visually
    const displayBz = data.current_conditions.Bz_GSM + currentState.simBzOffset;
    ui.bzVal.textContent = displayBz.toFixed(1);
    
    ui.npVal.textContent = data.current_conditions.Np.toFixed(1);
    flashValue(ui.vswVal);
    flashValue(ui.bzVal);
    flashValue(ui.npVal);
    
    // Update Telemetry Log dynamically
    updateTelemetryLog(displayBz, data.current_conditions.electron_flux_gt2MeV);
    
    // Update Kp Index
    if (ui.kpIndex && data.current_conditions.Kp) {
        const kp = data.current_conditions.Kp.toFixed(1);
        ui.kpIndex.textContent = kp;
        flashValue(ui.kpIndex);
        if (kp >= 5) {
            ui.kpIndex.style.color = 'var(--red)';
        } else if (kp >= 4) {
            ui.kpIndex.style.color = 'var(--amber)';
        } else {
            ui.kpIndex.style.color = 'var(--green)';
        }
    }
    
    // Update Charts
    updateMainChart(data);
    updateDriverCharts(data);
}

function updateAdvisoryPanel(flux) {
    const pnl = ui.advisoryIcon.closest('.panel');
    pnl.classList.remove('critical-alert', 'warning-alert');
    
    const timeStr = new Date().toISOString().substring(11, 16) + 'Z';
    ui.advisoryUpdatedTime.textContent = `UPDATED • ${timeStr}`;
    
    if (flux >= currentState.thresholds.severe) {
        ui.advisoryIcon.className = 'advisory-icon critical';
        ui.advisoryLevelText.className = 'advisory-level critical';
        ui.advisoryLevelText.textContent = 'SEVERE';
        ui.advisoryDescText.textContent = 'Severe radiation environment. Deep-dielectric charging highly likely. Operational anomalies expected.';
        ui.statusIndicator.textContent = '■ SEVERE';
        ui.statusIndicator.className = 'header-stat-value';
        ui.statusIndicator.style.color = 'var(--red)';
        pnl.classList.add('critical-alert');
    } else if (flux >= currentState.thresholds.elevated) {
        ui.advisoryIcon.className = 'advisory-icon warning';
        ui.advisoryLevelText.className = 'advisory-level warning';
        ui.advisoryLevelText.textContent = 'ELEVATED';
        ui.advisoryDescText.textContent = 'High energetic electron flux detected. Increased risk of surface charging and minor anomalies.';
        ui.statusIndicator.textContent = '■ WARNING';
        ui.statusIndicator.className = 'header-stat-value warning';
        ui.statusIndicator.style.color = 'var(--amber)';
        pnl.classList.add('warning-alert');
    } else {
        ui.advisoryIcon.className = 'advisory-icon nominal';
        ui.advisoryLevelText.className = 'advisory-level nominal';
        ui.advisoryLevelText.textContent = 'NOMINAL';
        ui.advisoryDescText.textContent = 'Radiation environment nominal. No enhanced surface or deep-dielectric charging expected.';
        ui.statusIndicator.textContent = '■ SAFE';
        ui.statusIndicator.className = 'header-stat-value safe';
        ui.statusIndicator.style.color = 'var(--green)';
    }
}

// Telemetry Log Update
function updateTelemetryLog(bz, flux) {
    const logContainer = document.querySelector('.log-content');
    if (!logContainer) return;
    
    const now = new Date();
    const timeStr = `[${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z]`;
    
    let msg = `Data ingestion complete. ${Math.floor(Math.random() * 50 + 250)} samples.`;
    let type = '';
    
    const rand = Math.random();
    if (bz < -10) {
        msg = `Bz strongly southward (${bz.toFixed(1)} nT). Geomagnetic storm active.`;
        type = 'critical';
    } else if (flux > 1e4) {
        msg = `Flux threshold exceeded. High risk of electrostatic discharge.`;
        type = 'critical';
    } else if (rand > 0.8) {
        msg = `GSAT subsystem health check OK`;
    } else if (rand > 0.6) {
        msg = `Transformer weights synchronized (Latency: ${Math.floor(Math.random() * 20 + 10)}ms)`;
    } else if (rand > 0.4) {
        msg = `Model prediction confidence: ${(90 + Math.random() * 8).toFixed(1)}%`;
    }
    
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-msg ${type}">${msg}</span>`;
    
    // Add to top
    logContainer.prepend(div);
    
    // Keep max 20 lines
    if (logContainer.children.length > 20) {
        logContainer.lastElementChild.remove();
    }
}

// ============================================================
// Chart Setup & Rendering
// ============================================================

Chart.defaults.color = 'rgba(200, 215, 230, 0.6)';
Chart.defaults.font.family = "'JetBrains Mono', monospace";

// Register Chart.js Annotation Plugin explicitly (required for Chart.js v3+)
const annotationPlugin = window.chartjsPluginAnnotation || window['chartjs-plugin-annotation'];
if (annotationPlugin) {
    try {
        Chart.register(annotationPlugin);
        console.log("Chart.js Annotation Plugin registered successfully.");
    } catch (e) {
        console.warn("Failed to register Chart.js Annotation Plugin:", e);
    }
} else {
    console.warn("Chart.js Annotation Plugin not found in global window context.");
}

function initCharts() {
    try {
        const ctxMain = document.getElementById('forecast-chart').getContext('2d');
    const ctxVsw = document.getElementById('chart-vsw').getContext('2d');
    const ctxBz = document.getElementById('chart-bz').getContext('2d');
    const ctxNp = document.getElementById('chart-np').getContext('2d');

    // Common options for mini charts
    const miniChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
            x: { display: true, grid: { display: false, drawBorder: false }, ticks: { font: { size: 9 }, maxTicksLimit: 4 } },
            y: { display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }, border: { dash: [2, 4] }, ticks: { font: { size: 9 }, maxTicksLimit: 3 } }
        },
        elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.1 } }
    };

    vswChart = new Chart(ctxVsw, { type: 'line', data: { datasets: [{ borderColor: '#00e5ff', backgroundColor: 'rgba(0, 229, 255, 0.1)', fill: true }] }, options: Object.assign({}, miniChartOptions) });
    bzChart = new Chart(ctxBz, { type: 'line', data: { datasets: [{ borderColor: '#ffab00', backgroundColor: 'rgba(255, 171, 0, 0.1)', fill: true }] }, options: Object.assign({}, miniChartOptions) });
    npChart = new Chart(ctxNp, { type: 'line', data: { datasets: [{ borderColor: '#ff1744', backgroundColor: 'rgba(255, 23, 68, 0.1)', fill: true }] }, options: Object.assign({}, miniChartOptions) });

    // Main Forecast Chart
    forecastChart = new Chart(ctxMain, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 20, 40, 0.95)',
                    titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: 'bold' },
                    borderColor: 'rgba(0, 229, 255, 0.3)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toExponential(2);
                            }
                            return label;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        elevatedLine: {
                            type: 'line',
                            yMin: Math.log10(currentState.thresholds.elevated),
                            yMax: Math.log10(currentState.thresholds.elevated),
                            borderColor: '#ffab00',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            label: { display: true, content: 'ELEVATED · 1E3', position: 'start', backgroundColor: 'transparent', color: '#ffab00', font: { family: "'JetBrains Mono'", size: 10 } }
                        },
                        severeLine: {
                            type: 'line',
                            yMin: Math.log10(currentState.thresholds.severe),
                            yMax: Math.log10(currentState.thresholds.severe),
                            borderColor: '#ff1744',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            label: { display: true, content: 'SEVERE · 1E4', position: 'start', backgroundColor: 'transparent', color: '#ff1744', font: { family: "'JetBrains Mono'", size: 10 } }
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } }
                },
                y: {
                    type: 'linear', // Using log10 values manually for better tick control
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    min: 0,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            if (value === 0) return '1';
                            if (value === 1) return '10';
                            if (value === 2) return '100';
                            if (value === 3) return '1k';
                            if (value === 4) return '10k';
                            if (value === 5) return '100k';
                            return '';
                        },
                        font: { size: 10 }
                    }
                }
            },
            elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } }
        }
    });
    } catch (e) {
        console.error("Error during Chart.js initialization:", e);
    }
}

function updateMainChart(data) {
    if (!forecastChart) {
        console.warn("forecastChart is not initialized. Skipping update.");
        return;
    }
    try {
        const labels = [];
        const obsData = [];
        const predData = [];
        const simData = [];
        
        // Calculate simulated scale factor based on IMF Bz offset
        const displayBz = data.current_conditions.Bz_GSM + currentState.simBzOffset;
        let simFactor = 1.0;
        if (displayBz < -5) {
            simFactor = 1.0 + Math.abs(displayBz) * 0.1;
        } else if (displayBz < 0) {
            simFactor = 1.1;
        }
        
        // Process History
        data.history.forEach(pt => {
            labels.push(pt.time.substring(11, 16) + 'Z');
            // Convert to log10 for rendering
            obsData.push(pt.flux > 0 ? Math.log10(pt.flux) : null);
            predData.push(null);
            simData.push(null);
        });
        
        // Connect history to prediction
        if (obsData.length > 0 && data.forecast.length > 0) {
            const lastObs = obsData[obsData.length - 1];
            predData[obsData.length - 1] = lastObs;
            simData[obsData.length - 1] = lastObs;
        }
        
        // Process Forecast based on selected horizon
        const horizonSteps = currentState.horizon;
        const forecastPts = data.forecast.slice(0, horizonSteps);
        
        forecastPts.forEach(pt => {
            labels.push(pt.time.substring(11, 16) + 'Z');
            obsData.push(null);
            
            // Baseline forecast
            const baseFlux = pt.flux;
            predData.push(baseFlux > 0 ? Math.log10(baseFlux) : null);
            
            // Simulated forecast (applied simulation factor)
            const simFlux = baseFlux * simFactor;
            simData.push(simFlux > 0 ? Math.log10(simFlux) : null);
        });
        
        // Check if any simulated forecast point exceeds thresholds
        let maxSimVal = 0;
        simData.forEach(val => {
            if (val !== null && val > maxSimVal) maxSimVal = val;
        });
        
        // Trigger emergency visuals/audio warning if simulated forecast is critical
        const isSevere = (maxSimVal >= Math.log10(currentState.thresholds.severe));
        updateAlertVisualsAndAudio(isSevere);

        forecastChart.data.labels = labels;
        
        const datasets = [
            {
                label: 'OBSERVED',
                data: obsData,
                borderColor: '#00e5ff',
                borderWidth: 1.5,
                tension: 0.1
            },
            {
                label: 'FORECAST (BASELINE)',
                data: predData,
                borderColor: '#00e676',
                borderWidth: 1.5,
                borderDash: [5, 5],
                tension: 0.1
            }
        ];
        
        // Add dynamic simulation line if slider is active
        if (currentState.simBzOffset !== 0) {
            const simColor = isSevere ? '#ff1744' : '#ffab00';
            datasets.push({
                label: 'WHAT-IF FORECAST',
                data: simData,
                borderColor: simColor,
                borderWidth: 2,
                borderDash: [2, 2],
                tension: 0.1
            });
        }
        
        forecastChart.data.datasets = datasets;
        forecastChart.update();
    } catch (e) {
        console.error("Error updating main forecast chart:", e);
    }
}

function updateDriverCharts(data) {
    try {
        const labels = data.history.map(pt => pt.time.substring(11, 16) + 'Z').slice(-60); // Last 5 hours approx
        
        if (vswChart) {
            const vswData = data.history.map(pt => pt.vsw).slice(-60);
            vswChart.data.labels = labels;
            vswChart.data.datasets[0].data = vswData;
            vswChart.options.scales.y.min = Math.min(...vswData) - 50;
            vswChart.options.scales.y.max = Math.max(...vswData) + 50;
            vswChart.update();
        }
        
        if (bzChart) {
            const bzData = data.history.map(pt => pt.bz).slice(-60);
            bzChart.data.labels = labels;
            bzChart.data.datasets[0].data = bzData;
            bzChart.options.scales.y.min = -15;
            bzChart.options.scales.y.max = 15;
            bzChart.update();
        }
        
        if (npChart) {
            const npData = data.history.map(pt => pt.np).slice(-60);
            npChart.data.labels = labels;
            npChart.data.datasets[0].data = npData;
            npChart.options.scales.y.min = 0;
            npChart.options.scales.y.max = Math.max(...npData, 10) + 5;
            npChart.update();
        }
    } catch (e) {
        console.error("Error updating driver mini charts:", e);
    }
}

// ============================================================
// Mock Data Generator (For Demo Purposes)
// ============================================================

function generateMockData() {
    const now = new Date();
    const history = [];
    const forecast = [];
    
    // Storm Preset Logic
    let fluxBase = 2; // 10^2
    let vswBase = 450;
    let bzBase = 0;
    let npBase = 5;
    let amplitude = 1;
    
    if (currentState.activeStorm === 'st_patricks_2015') {
        fluxBase = 3.7; // ~5e3
        vswBase = 700;
        bzBase = -15;
        amplitude = 2;
    } else if (currentState.activeStorm === 'halloween_2003') {
        fluxBase = 4.3; // ~2e4
        vswBase = 1200;
        bzBase = -25;
        amplitude = 3;
    } else if (currentState.activeStorm === 'bastille_2000') {
        fluxBase = 3.9; // ~8e3
        vswBase = 900;
        bzBase = -18;
        amplitude = 2.5;
    }
    
    let currentFlux, currentVsw, currentBz, currentNp;
    
    for (let i = -288; i <= 0; i++) {
        const t = new Date(now.getTime() + i * 5 * 60000);
        const timeMs = t.getTime();
        
        // Deterministic sum-of-sines based on absolute time
        const wave1 = Math.sin(timeMs / 1000000);
        const wave2 = Math.cos(timeMs / 350000);
        const wave3 = Math.sin(timeMs / 120000);
        
        currentFlux = Math.pow(10, fluxBase + (wave1 * 0.8 + wave2 * 0.3) * amplitude);
        currentVsw = vswBase + (wave1 * 100 + wave3 * 50) * amplitude;
        currentBz = bzBase + (wave2 * 5 + wave3 * 3) * amplitude;
        currentNp = npBase + (wave1 * 3 + wave2 * 2) * amplitude;
        
        history.push({
            time: t.toISOString(),
            flux: currentFlux,
            vsw: currentVsw,
            bz: currentBz,
            np: Math.max(1, currentNp)
        });
    }
    
    // Apply What If Simulator Offset to the final known point
    const effectiveBz = currentBz + currentState.simBzOffset;
    
    let predFlux = currentFlux;
    for (let i = 1; i <= 144; i++) {
        const t = new Date(now.getTime() + i * 5 * 60000);
        const timeMs = t.getTime();
        
        // Deterministic prediction
        const wave1 = Math.sin(timeMs / 1000000);
        const wave2 = Math.cos(timeMs / 350000);
        predFlux = Math.pow(10, fluxBase + (wave1 * 0.8 + wave2 * 0.3) * amplitude);
        
        // Simulator effect: Negative Bz drastically increases flux prediction
        if (effectiveBz < -5) {
            predFlux *= (1 + Math.abs(effectiveBz) * 0.1); 
        } else if (effectiveBz < 0) {
            predFlux *= 1.1; 
        }
        
        forecast.push({
            time: t.toISOString(),
            flux: predFlux
        });
    }
    
    ui.obsSamples.textContent = "288";
    
    // Calculate synthetic Kp based on Vsw and Bz
    let kp = 1 + (currentVsw / 400) + (effectiveBz < 0 ? Math.abs(effectiveBz) / 5 : 0);
    kp = Math.min(9, Math.max(0, kp));
    
    return {
        current_conditions: {
            electron_flux_gt2MeV: currentFlux,
            Vsw: currentVsw,
            Bz_GSM: currentBz,
            Np: currentNp,
            Kp: kp
        },
        history: history,
        forecast: forecast
    };
}

// ============================================================
// Interactive Enhancements Helper Functions
// ============================================================

function playWarningAlarm() {
    if (currentState.audioMuted) return;
    
    // Limit pitch alarm plays to once every 4 seconds to be comfortable
    const now = Date.now();
    if (now - currentState.lastAudioAlertTime < 4000) return;
    currentState.lastAudioAlertTime = now;
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const audioCtx = new AudioContext();
        
        // Synthesize space console notification
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        
        // Alert sound design (pitch sweeps from 880Hz to 660Hz)
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(580, audioCtx.currentTime + 0.35);
        
        gain.gain.setValueAtTime(0.04, audioCtx.currentTime); // Soft volume
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.45);
    } catch (err) {
        console.warn("Could not play synthesized audio alarm:", err);
    }
}

function updateAlertVisualsAndAudio(isSevere) {
    const mainSection = document.querySelector('.chart-section');
    const advisorySection = document.querySelector('.advisory-section');
    
    if (isSevere) {
        // Red flashing state on borders
        if (mainSection) mainSection.classList.add('critical-alert');
        if (advisorySection) advisorySection.classList.add('critical-alert');
        
        if (ui.statusIndicator) {
            ui.statusIndicator.textContent = '■ CRITICAL';
            ui.statusIndicator.style.color = 'var(--red)';
            ui.statusIndicator.className = 'header-stat-value';
        }
        
        playWarningAlarm();
        
        // Update Advisory Box to Severe WARNING
        if (ui.advisoryIcon) {
            ui.advisoryIcon.className = 'advisory-icon critical';
            ui.advisoryIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        }
        if (ui.advisoryLevelText) {
            ui.advisoryLevelText.textContent = 'CRITICAL WARNING';
            ui.advisoryLevelText.className = 'advisory-level critical';
        }
        if (ui.advisoryDescText) {
            ui.advisoryDescText.textContent = 'CRITICAL: Southward Bz offset simulation triggers high electron flux forecast. Elevated spacecraft dielectric charging risk.';
        }
    } else {
        // Clear flashing alert states
        if (mainSection) mainSection.classList.remove('critical-alert');
        if (advisorySection) advisorySection.classList.remove('critical-alert');
        
        if (ui.statusIndicator) {
            const currentVal = forecastChart && forecastChart.data && forecastChart.data.datasets[0] && forecastChart.data.datasets[0].data.length > 0
                ? Math.pow(10, Math.max(...forecastChart.data.datasets[0].data.filter(v => v !== null)))
                : 0;
            
            if (currentVal >= currentState.thresholds.elevated) {
                ui.statusIndicator.textContent = '■ WARNING';
                ui.statusIndicator.style.color = 'var(--amber)';
                ui.statusIndicator.className = 'header-stat-value';
                
                if (ui.advisoryIcon) {
                    ui.advisoryIcon.className = 'advisory-icon warning';
                }
                if (ui.advisoryLevelText) {
                    ui.advisoryLevelText.textContent = 'ELEVATED';
                    ui.advisoryLevelText.className = 'advisory-level warning';
                }
            } else {
                ui.statusIndicator.textContent = '■ SAFE';
                ui.statusIndicator.style.color = 'var(--green)';
                ui.statusIndicator.className = 'header-stat-value safe';
                
                if (ui.advisoryIcon) {
                    ui.advisoryIcon.className = 'advisory-icon nominal';
                    ui.advisoryIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`;
                }
                if (ui.advisoryLevelText) {
                    ui.advisoryLevelText.textContent = 'NOMINAL';
                    ui.advisoryLevelText.className = 'advisory-level nominal';
                }
                if (ui.advisoryDescText) {
                    ui.advisoryDescText.textContent = 'Radiation environment nominal. No enhanced surface or deep-dielectric charging expected.';
                }
            }
        }
    }
}

function handleIngestedFile(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const text = event.target.result;
            const parsedData = parseCSVDataset(text);
            
            currentState.customIngestedData = parsedData;
            
            // Adjust API link badge style
            if (ui.apiStatus) {
                ui.apiStatus.innerHTML = '<div class="dot" style="background:var(--amber);"></div> CUSTOM CSV';
                ui.apiStatus.className = 'link-badge';
                ui.apiStatus.style.borderColor = 'rgba(255, 171, 0, 0.4)';
                ui.apiStatus.style.color = 'var(--amber)';
            }
            
            appendCustomLog(`Ingested local dataset: "${file.name}" (${parsedData.history.length} samples).`, '');
            
            // Refresh dashboard visually
            updateDashboardUI(parsedData);
        } catch (e) {
            console.error("CSV Ingestion error:", e);
            appendCustomLog(`Dataset Ingestion Failed: ${e.message}`, 'critical');
            alert(`Failed to parse CSV: ${e.message}`);
        }
    };
    reader.readAsText(file);
}

function appendCustomLog(msg, type = '') {
    const logContainer = document.querySelector('.log-content');
    if (!logContainer) return;
    
    const now = new Date();
    const timeStr = `[${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}Z]`;
    
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-msg ${type}">${msg}</span>`;
    logContainer.prepend(div);
    
    if (logContainer.children.length > 20) {
        logContainer.lastElementChild.remove();
    }
}

function parseCSVDataset(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) throw new Error("File empty or missing headers");
    
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    
    const timeIdx = headers.findIndex(h => h.includes('time') || h.includes('date'));
    const fluxIdx = headers.findIndex(h => h.includes('flux') || h.includes('electron'));
    const vswIdx = headers.findIndex(h => h.includes('vsw') || h.includes('speed') || h.includes('wind'));
    const bzIdx = headers.findIndex(h => h.includes('bz') || h.includes('imf'));
    const npIdx = headers.findIndex(h => h.includes('np') || h.includes('density') || h.includes('proton'));
    
    if (fluxIdx === -1) throw new Error("Missing 'flux' or 'electron' data column.");
    
    const history = [];
    const forecast = [];
    const now = new Date();
    
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < headers.length) continue;
        
        const rawTime = timeIdx !== -1 ? cols[timeIdx] : null;
        const time = rawTime ? new Date(rawTime) : new Date(now.getTime() + (i - lines.length) * 5 * 60000);
        
        const flux = parseFloat(cols[fluxIdx]);
        const vsw = vswIdx !== -1 ? parseFloat(cols[vswIdx]) : 400;
        const bz = bzIdx !== -1 ? parseFloat(cols[bzIdx]) : 0;
        const np = npIdx !== -1 ? parseFloat(cols[npIdx]) : 5;
        
        if (isNaN(flux)) continue;
        
        history.push({
            time: time.toISOString(),
            flux: flux,
            vsw: isNaN(vsw) ? 400 : vsw,
            bz: isNaN(bz) ? 0 : bz,
            np: isNaN(np) ? 5 : np
        });
    }
    
    if (history.length === 0) throw new Error("No valid rows parsed");
    
    history.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    const lastPt = history[history.length - 1];
    let runningFlux = lastPt.flux;
    for (let i = 1; i <= 144; i++) {
        const t = new Date(new Date(lastPt.time).getTime() + i * 5 * 60000);
        runningFlux = runningFlux * (0.97 + Math.random() * 0.06);
        forecast.push({
            time: t.toISOString(),
            flux: runningFlux
        });
    }
    
    // Synthesize Kp based on wind speed and Bz
    let kp = 1 + (lastPt.vsw / 400) + (lastPt.bz < 0 ? Math.abs(lastPt.bz) / 5 : 0);
    kp = Math.min(9, Math.max(0, kp));
    
    return {
        current_conditions: {
            electron_flux_gt2MeV: lastPt.flux,
            Vsw: lastPt.vsw,
            Bz_GSM: lastPt.bz,
            Np: lastPt.np,
            Kp: kp
        },
        history: history,
        forecast: forecast
    };
}

function startTelemetryLogStreamer() {
    const telemetryMessages = [
        "GSAT-19 solar wing orientation nominal",
        "Transformer weights synchronized (Latency: 14ms)",
        "GOES satellite telemetry feed sync OK",
        "Solar wind density variations checked: stable",
        "Kp index recalculation complete: nominal state",
        "Magnetometer boom resonance check: normal",
        "Geomagnetic storm prediction drift model updated",
        "Wind spacecraft data buffer ingested",
        "RCS thruster temperature check: normal",
        "Radiation belt drift shell modeling complete"
    ];
    
    setInterval(() => {
        const activeData = currentState.customIngestedData || generateMockData();
        const displayBz = activeData.current_conditions.Bz_GSM + currentState.simBzOffset;
        
        if (displayBz < -5) {
            appendCustomLog(`WARNING: Southward Bz field detected (${displayBz.toFixed(1)} nT). Monitoring solar wind drift.`, 'critical');
        } else {
            const randMsg = telemetryMessages[Math.floor(Math.random() * telemetryMessages.length)];
            appendCustomLog(randMsg, '');
        }
    }, 8000);
}
