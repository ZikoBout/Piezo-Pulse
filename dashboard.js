// État de connexion
let isConnected = false;
let esp32Connected = false;
const connectionCheckInterval = 5000; // 5 secondes
const voltageHistory = [];
let dataInterval;
let isGeneratingCurve = false;

// Paramètres réalistes
const MAX_VOLTAGE = 12; // Maximum théorique
const BASE_NOISE = 0.1; // Bruit de fond en volts
const PRESSURE_EVENTS_PER_MIN = 15; // Nombre d'événements de pression par minute
let lastPressureTime = 0;

// Éléments DOM
const connectionBadge = document.getElementById('connectionBadge');
const noDataOverlay = document.getElementById('noDataOverlay');
const retryBtn = document.getElementById('retryBtn');
const esp32Status = document.getElementById('esp32Status');

// Initialisation du graphique
const ctx = document.getElementById('energyChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Tension (V)',
            data: [],
            borderColor: '#00d084',
            backgroundColor: 'rgba(0, 208, 132, 0.1)',
            borderWidth: 2,
            tension: 0.1, // Réduit pour plus de réalisme
            fill: true
        }]
    },
    options: getChartOptions()
});

function getChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                max: MAX_VOLTAGE,
                min: 0,
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)'
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)',
                    callback: function(value) {
                        return value + 'V';
                    }
                }
            },
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    color: 'rgba(255, 255, 255, 0.7)'
                }
            }
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(15, 32, 39, 0.9)',
                titleColor: '#00d084',
                bodyColor: 'white',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1,
                callbacks: {
                    label: function(context) {
                        return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}V`;
                    }
                }
            }
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    };
}

function generateRealisticData() {
    if (!isConnected || isGeneratingCurve) return;

    const now = new Date();
    const currentTime = now.getTime();
    const labels = chart.data.labels.slice(-59) || []; // Garder 1 minute de données
    const data = chart.data.datasets[0].data.slice(-59) || [];

    // Simuler des événements de pression aléatoires
    let voltage = BASE_NOISE;
    
    // Probabilité d'avoir un événement de pression
    if (Math.random() < PRESSURE_EVENTS_PER_MIN / 60 / (1000/2000)) { // 2000ms = intervalle
        // Voltage généré dépend du temps depuis le dernier événement
        const timeSinceLast = (currentTime - lastPressureTime) / 1000; // en secondes
        lastPressureTime = currentTime;
        
        // Plus c'est rare, plus c'est intense (max 12V)
        const baseVoltage = Math.min(MAX_VOLTAGE, 3 + (Math.random() * 9));
        
        // Forme de vague réaliste
        voltage = baseVoltage;
        
        // Ajouter une décroissance exponentielle après le pic
        setTimeout(() => {
            const decaySteps = 5; // Nombre de points de décroissance
            let decayCount = 0;
            
            const decayInterval = setInterval(() => {
                if (decayCount >= decaySteps || !isConnected) {
                    clearInterval(decayInterval);
                    return;
                }
                
                decayCount++;
                const decayedVoltage = (baseVoltage * Math.exp(-decayCount/2)).toFixed(2);
                
                const decayTime = new Date();
                labels.push(decayTime.toLocaleTimeString());
                data.push(parseFloat(decayedVoltage));
                voltageHistory.push({ 
                    time: decayTime, 
                    voltage: parseFloat(decayedVoltage) 
                });
                
                updateChart(labels, data);
                updateMetrics(parseFloat(decayedVoltage));
            }, 500); // Décroissance toutes les 500ms
        }, 100);
    }

    labels.push(now.toLocaleTimeString());
    data.push(parseFloat(voltage.toFixed(2)));
    voltageHistory.push({ time: now, voltage: parseFloat(voltage.toFixed(2)) });

    updateChart(labels, data);
    updateMetrics(voltage);
}

function generateVoltageCurve() {
    if (!isConnected || isGeneratingCurve) return;
    
    isGeneratingCurve = true;
    const originalInterval = dataInterval;
    clearInterval(dataInterval);
    
    // Courbe réaliste avec montée progressive et palier
    const curve = [
        0, 1.5, 3.2, 5.0, 7.0,  // Montée initiale
        8.5, 9.8, 10.5, 11.0,    // Approche du max
        11.5, 11.8, 12.0,         // Pic à 12V
        11.8, 11.3, 10.5,         // Descente initiale
        9.0, 7.5, 6.0, 4.5, 3.0, 1.5, 0  // Retour à zéro
    ];

    const now = new Date();
    const labels = chart.data.labels.slice(-10) || []; // Garder quelques points
    const data = chart.data.datasets[0].data.slice(-10) || [];
    
    let step = 0;
    const curveInterval = setInterval(() => {
        if (step >= curve.length || !isConnected) {
            clearInterval(curveInterval);
            isGeneratingCurve = false;
            if (isConnected) {
                dataInterval = setInterval(generateRealisticData, 2000);
            }
            return;
        }
        
        const voltage = curve[step];
        const time = new Date(now.getTime() + step * 300); // 300ms entre chaque point
        
        labels.push(time.toLocaleTimeString());
        data.push(voltage);
        voltageHistory.push({ time: time, voltage: voltage });
        
        updateChart(labels, data);
        updateMetrics(voltage);
        
        step++;
    }, 300);
}

function updateChart(labels, data) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
}

function updateMetrics(currentVoltage) {
    document.getElementById('currentPower').textContent = currentVoltage.toFixed(2) + " V";
    
    // Calcul réaliste de l'énergie (intégrale de la tension sur le temps)
    let totalEnergy = 0;
    if (voltageHistory.length > 1) {
        for (let i = 1; i < voltageHistory.length; i++) {
            const deltaT = (voltageHistory[i].time - voltageHistory[i-1].time) / 3600000; // en heures
            const avgV = (voltageHistory[i].voltage + voltageHistory[i-1].voltage) / 2;
            totalEnergy += avgV * deltaT; // V × h = Wh
        }
    }
    
    document.getElementById('todayEnergy').textContent = totalEnergy.toFixed(2) + " Wh";
    
    // Efficacité en pourcentage du max
    const efficiency = (currentVoltage / MAX_VOLTAGE * 100).toFixed(1);
    document.getElementById('efficiency').textContent = efficiency + "%";
    
    // Mettre à jour la tendance
    const trendElement = document.querySelector('.metric-trend');
    if (currentVoltage >= MAX_VOLTAGE * 0.8) {
        trendElement.className = 'metric-trend positive';
        trendElement.innerHTML = '<i class="fas fa-arrow-up"></i> High';
    } else if (currentVoltage >= MAX_VOLTAGE * 0.5) {
        trendElement.className = 'metric-trend positive';
        trendElement.innerHTML = '<i class="fas fa-arrow-up"></i> Medium';
    } else {
        trendElement.className = 'metric-trend negative';
        trendElement.innerHTML = '<i class="fas fa-arrow-down"></i> Low';
    }
    
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

function resetData() {
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.update();
    voltageHistory.length = 0;
    lastPressureTime = 0;
    
    document.getElementById('currentPower').textContent = "0.00 V";
    document.getElementById('todayEnergy').textContent = "0.00 Wh";
    document.getElementById('efficiency').textContent = "0%";
}

// Connexion ESP32
function toggleConnection() {
    isConnected = !isConnected;
    esp32Connected = isConnected;
    updateConnectionUI();
    
    if (isConnected) {
        startDataFlow();
        showAlert("ESP32 connected successfully", "success");
    } else {
        stopDataFlow();
        showAlert("ESP32 disconnected", "warning");
    }
}

function updateConnectionUI() {
    if (isConnected) {
        connectionBadge.innerHTML = '<i class="fas fa-plug"></i> Piezo-Pulse Connected';
        connectionBadge.classList.remove('disconnected');
        connectionBadge.classList.add('connected');
        noDataOverlay.style.display = 'none';
        document.querySelector('.connection-alert').style.display = 'none';
        
        if (esp32Status) {
            esp32Status.innerHTML = '<i class="fas fa-microchip"></i> ESP32: Connected';
            esp32Status.classList.remove('disconnected');
            esp32Status.classList.add('connected');
        }
    } else {
        connectionBadge.innerHTML = '<i class="fas fa-unlink"></i> Piezo-Pulse Not Connected';
        connectionBadge.classList.remove('connected');
        connectionBadge.classList.add('disconnected');
        noDataOverlay.style.display = 'flex';
        document.querySelector('.connection-alert').style.display = 'flex';
        
        if (esp32Status) {
            esp32Status.innerHTML = '<i class="fas fa-microchip"></i> ESP32: Disconnected';
            esp32Status.classList.remove('connected');
            esp32Status.classList.add('disconnected');
        }
    }
}

function showAlert(message, type) {
    const alertBox = document.createElement('div');
    alertBox.className = `alert-${type}`;
    alertBox.textContent = message;
    document.body.appendChild(alertBox);
    
    setTimeout(() => {
        alertBox.remove();
    }, 3000);
}

// Gestion du flux de données
function startDataFlow() {
    resetData();
    dataInterval = setInterval(generateRealisticData, 2000);
}

function stopDataFlow() {
    clearInterval(dataInterval);
    resetData();
}

// Gestion des touches clavier
function handleKeyPress(e) {
    if (e.key === '`') {
        toggleConnection();
    } else if (e.key === '8' && isConnected && !isGeneratingCurve) {
        generateVoltageCurve();
    }
}

// Gestion du bouton Réessayer
retryBtn.addEventListener('click', () => {
    retryBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    setTimeout(() => {
        toggleConnection();
        retryBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Retry Connection';
    }, 1000);
});

// Initialisation
document.addEventListener('keypress', handleKeyPress);

// Styles pour les alertes
const style = document.createElement('style');
style.textContent = `
    .alert-success {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 208, 132, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000;
        animation: fadeIn 0.3s;
    }
    .alert-warning {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 193, 7, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000;
        animation: fadeIn 0.3s;
    }
    @keyframes fadeIn {
        from { opacity: 0; bottom: 0; }
        to { opacity: 1; bottom: 20px; }
    }
`;
document.head.appendChild(style);