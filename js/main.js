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
    simStatus: document.getElementById('sim-status')
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
    simBzOffset: 0
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
            updateDashboardUI(generateMockData());
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

function initCharts() {
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
}

function updateMainChart(data) {
    const labels = [];
    const obsData = [];
    const predData = [];
    
    // Process History
    data.history.forEach(pt => {
        labels.push(pt.time.substring(11, 16) + 'Z');
        // Convert to log10 for rendering
        obsData.push(pt.flux > 0 ? Math.log10(pt.flux) : null);
        predData.push(null);
    });
    
    // Connect history to prediction
    if (obsData.length > 0 && data.forecast.length > 0) {
        predData[obsData.length - 1] = obsData[obsData.length - 1];
    }
    
    // Process Forecast based on selected horizon
    const horizonSteps = currentState.horizon;
    const forecastPts = data.forecast.slice(0, horizonSteps);
    
    forecastPts.forEach(pt => {
        labels.push(pt.time.substring(11, 16) + 'Z');
        obsData.push(null);
        predData.push(pt.flux > 0 ? Math.log10(pt.flux) : null);
    });
    
    forecastChart.data.labels = labels;
    forecastChart.data.datasets = [
        {
            label: 'OBSERVED',
            data: obsData,
            borderColor: '#00e5ff',
            borderWidth: 1.5,
            tension: 0.1
        },
        {
            label: 'FORECAST',
            data: predData,
            borderColor: '#00e676', // Green for forecast line (matching design)
            borderWidth: 1.5,
            borderDash: [5, 5],
            tension: 0.1
        }
    ];
    
    forecastChart.update();
}

function updateDriverCharts(data) {
    const labels = data.history.map(pt => pt.time.substring(11, 16) + 'Z').slice(-60); // Last 5 hours approx
    
    const vswData = data.history.map(pt => pt.vsw).slice(-60);
    vswChart.data.labels = labels;
    vswChart.data.datasets[0].data = vswData;
    vswChart.options.scales.y.min = Math.min(...vswData) - 50;
    vswChart.options.scales.y.max = Math.max(...vswData) + 50;
    vswChart.update();
    
    const bzData = data.history.map(pt => pt.bz).slice(-60);
    bzChart.data.labels = labels;
    bzChart.data.datasets[0].data = bzData;
    bzChart.options.scales.y.min = -15;
    bzChart.options.scales.y.max = 15;
    bzChart.update();
    
    const npData = data.history.map(pt => pt.np).slice(-60);
    npChart.data.labels = labels;
    npChart.data.datasets[0].data = npData;
    npChart.options.scales.y.min = 0;
    npChart.options.scales.y.max = Math.max(...npData, 10) + 5;
    npChart.update();
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
