// JS/app.js

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});

let travelData = [];

async function fetchData() {
    try {
        const response = await fetch('data/travel_data.json');
        travelData = await response.json();
        initApp();
    } catch (error) {
        console.error('Error loading data:', error);
        document.body.innerHTML = '<div class="p-4 text-red-500">Failed to load itinerary data.</div>';
    }
}

function initApp() {
    // Determine view based on URL hash or default
    handleRouting();
    window.addEventListener('hashchange', handleRouting);
}

function handleRouting() {
    const hash = window.location.hash;
    const mainContent = document.getElementById('main-content');

    if (!hash || hash === '#overview') {
        renderOverview(mainContent);
        updateNavState('overview');
    } else if (hash.startsWith('#day')) {
        const dayIndex = parseInt(hash.replace('#day', '')) - 1;
        if (travelData[dayIndex]) {
            renderDailyView(mainContent, dayIndex);
            updateNavState(`day${dayIndex + 1}`);
        }
    }
}

function updateNavState(activeId) {
    // Reset all buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = "nav-btn bg-white text-gray-600 border border-gray-300 px-4 py-1.5 rounded-full text-sm font-medium mr-2 flex-shrink-0 transition-all cursor-pointer";
    });

    // Set active
    const activeBtn = document.querySelector(`[data-target="${activeId}"]`);
    if (activeBtn) {
        activeBtn.className = "nav-btn active bg-teal-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-md mr-2 flex-shrink-0 transition-all cursor-pointer";
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

// --- Renderers ---

// Overview State
let overviewState = {
    start: '',
    end: '',
    fromToday: false
};

function renderOverview(container) {
    // 1. Filter Data
    let filteredData = travelData.filter(day => {
        // Fix Date Comparison: normalize to YYYY-MM-DD strings for accurate comparison
        const dayDateStr = day.date.replace(/\//g, '-'); // 2026/03/10 -> 2026-03-10
        const todayStr = new Date().toISOString().split('T')[0];

        if (overviewState.fromToday && dayDateStr < todayStr) return false;
        if (overviewState.start && dayDateStr < overviewState.start) return false;
        if (overviewState.end && dayDateStr > overviewState.end) return false;

        return true;
    });

    // 2. Render Controls
    let html = `
        <div class="animate-fade-in p-4 space-y-4 max-w-7xl mx-auto w-full">
            <div class="flex justify-between items-center mb-2">
                <h2 class="text-xl font-bold text-gray-800">行程總覽 🗺️</h2>
                <div class="text-xs text-gray-500">共 ${filteredData.length} 天</div>
            </div>
            
            <!-- Filters -->
            <div class="bg-white p-3 rounded-lg shadow-sm border border-gray-100 space-y-3">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                    <label class="font-bold text-gray-700 whitespace-nowrap">📅 日期:</label>
                    <input type="date" id="filter-start" value="${overviewState.start}" class="border rounded px-2 py-1 text-xs flex-1 min-w-[100px]" onchange="updateOverviewDate('start', this.value)">
                    <span class="text-gray-400">~</span>
                    <input type="date" id="filter-end" value="${overviewState.end}" class="border rounded px-2 py-1 text-xs flex-1 min-w-[100px]" onchange="updateOverviewDate('end', this.value)">
                </div>
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="filter-today" ${overviewState.fromToday ? 'checked' : ''} onchange="updateOverviewDate('fromToday', this.checked)" class="rounded text-teal-600 focus:ring-teal-500">
                    <label for="filter-today" class="text-sm text-gray-700 font-bold">只顯示今天以後 (From Today)</label>
                </div>
            </div>

            <!-- Horizontal Scroll Container -->
            <div class="flex overflow-x-auto gap-4 pb-4 no-scrollbar lg:pb-6" style="scroll-snap-type: x mandatory;">
    `;

    // 3. Render Columns
    if (filteredData.length === 0) {
        html += `<div class="w-full text-center text-gray-400 py-8">找不到符合日期的行程 🕵️</div>`;
    }

    filteredData.forEach((day, index) => {
        const mainCity = getMainCity(day);
        const dayIndex = travelData.indexOf(day) + 1; // Real day index from original data

        html += `
            <div class="min-w-[280px] w-[280px] bg-white rounded-xl shadow-md border border-gray-100 flex-shrink-0 flex flex-col relative" style="scroll-snap-align: start;">
                <!-- Header -->
                <a href="#day${dayIndex}" class="block p-4 border-b border-gray-100 bg-gray-50 rounded-t-xl hover:bg-gray-100 transition-colors group relative overflow-hidden">
                    <div class="flex justify-between items-start relative z-10">
                        <div>
                            <div class="text-lg font-bold text-${getDayColor(index)}-600">第 ${dayIndex} 天</div>
                            <div class="text-xs text-gray-500 font-medium mt-1">${day.date.slice(5)} ${day.dayOfWeek}</div>
                        </div>
                        <div class="text-right flex flex-col items-end">
                             ${mainCity ? `<span class="inline-block bg-white border border-gray-200 text-xs px-2 py-1 rounded-full text-gray-600 font-bold shadow-sm mb-2">📍 ${mainCity}</span>` : ''}
                             <div class="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded animate-wiggle flex items-center shadow-sm border border-blue-100">
                                查看詳情 👉
                             </div>
                        </div>
                    </div>
                </a>

                <!-- Content Blocks -->
                <div class="p-3 space-y-3 flex-1 overflow-y-auto max-h-[400px]">
                    ${renderOverviewPeriod(day, '早上', 'rose', '🌅')}
                    ${renderOverviewPeriod(day, '下午', 'amber', '☀️')}
                    ${renderOverviewPeriod(day, '晚上', 'indigo', '🌙')}
                </div>
            </div>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

// Helper: Update filter state
window.updateOverviewDate = function (key, value) {
    overviewState[key] = value;
    const mainContent = document.getElementById('main-content');
    renderOverview(mainContent);
};

// Helper: Get Main City
function getMainCity(day) {
    if (!day.periods) return '';
    const cities = {};
    day.periods.forEach(p => {
        p.timeline.forEach(t => {
            if (t.city && t.city.trim()) {
                cities[t.city] = (cities[t.city] || 0) + 1;
            }
        });
    });
    // Return the most frequent city, or the first one found
    const sortedCities = Object.keys(cities).sort((a, b) => cities[b] - cities[a]);
    return sortedCities.length > 0 ? sortedCities[0] : '';
}

// Helper: Get Day Color Cycle
function getDayColor(index) {
    const colors = ['teal', 'blue', 'purple', 'rose', 'orange'];
    return colors[index % colors.length];
}

// Helper: Render Period Block
function renderOverviewPeriod(day, periodName, color, icon) {
    // Find all events in this period (morning/afternoon/evening)
    // Note: The data structure has pre-grouped periods, let's try to match them loosely or use the exact names

    // We categorize periods from data into the 3 buckets
    const targetPeriods = day.periods.filter(p => {
        if (periodName === '早上') return p.period.includes('早');
        if (periodName === '下午') return p.period.includes('下');
        if (periodName === '晚上') return p.period.includes('晚');
        return false;
    });

    if (targetPeriods.length === 0) return '';

    let contentHtml = '';
    targetPeriods.forEach(p => {
        p.timeline.forEach(t => {
            // Keep it clean: Only Time + Title (No grey description)
            contentHtml += `
                <div class="mb-2 last:mb-0">
                    <div class="flex items-baseline gap-2">
                        <span class="text-[10px] font-mono text-gray-400 flex-shrink-0 w-8 text-right">${t.time || '--:--'}</span>
                        <span class="text-xs font-bold text-gray-700 line-clamp-1">${t.event}</span>
                    </div>
                </div>
            `;
        });
    });

    if (!contentHtml) return '';

    return `
        <div class="bg-${color}-50 rounded-lg p-2 border border-${color}-100">
            <div class="flex items-center gap-1 mb-2 border-b border-${color}-200 pb-1">
                <span class="text-xs">${icon}</span>
                <span class="text-xs font-bold text-${color}-600">${periodName}</span>
            </div>
            ${contentHtml}
        </div>
    `;
}

function renderDailyView(container, dayIndex) {
    const day = travelData[dayIndex];
    if (!day) return;

    // Use max-w-2xl for slightly wider desktop view, centered
    let html = `
        <div class="max-w-md md:max-w-2xl mx-auto animate-fade-in pb-12 w-full">
            <!-- Header -->
            <div class="bg-gradient-to-r from-teal-50 to-white border-l-4 border-teal-500 p-4 mb-6 rounded-r shadow-sm mx-4 mt-4 flex justify-between items-center">
                <div>
                    <h2 class="font-bold text-xl text-teal-800">Day ${dayIndex + 1} 🗓️</h2>
                    <p class="text-sm font-medium text-teal-600">${day.date} (${day.dayOfWeek})</p>
                </div>
                <button onclick="switchDay('overview')" class="text-xs bg-white text-gray-500 border px-3 py-1 rounded-full shadow-sm hover:bg-gray-50">
                    ↩️ 返回總覽
                </button>
            </div>
            
            <div class="px-4 space-y-8">
    `;

    // Render Periods
    day.periods.forEach(period => {
        const periodColor = getPeriodColor(period.period); // teal/orange/indigo

        html += `
            <div class="relative pl-6 border-l-2 border-gray-200 ml-2 md:ml-4">
                <!-- Period Label -->
                <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-${periodColor}-500 border-2 border-white z-10 shadow-sm"></div>
                <span class="text-xs font-bold text-${periodColor}-700 bg-${periodColor}-100 px-2 py-1 rounded mb-4 inline-block shadow-sm">
                    ${period.period} ${period.timeRange || ''}
                </span>

                <!-- Timeline Steps -->
                <div class="space-y-6 mt-2">
        `;

        // Render extracted sub-steps
        if (period.timeline && period.timeline.length > 0) {
            period.timeline.forEach((step, stepIndex) => {
                const isTransport = step.type === '交通';
                const cardIdBase = 'card-' + Math.random().toString(36).substr(2, 9);

                // Content Blocks
                const transportContent = `
                    <div class="space-y-2 text-xs text-gray-600">
                        ${step.start && step.start !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">📍 起點:</span> <span>${step.start}</span></div>` : ''}
                        ${step.end && step.end !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">🏁 終點:</span> <span>${step.end}</span></div>` : ''}
                        ${step.duration && step.duration !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">⏱️ 移動:</span> <span>${step.duration}</span></div>` : ''}
                        ${step.cost && step.cost !== '-' && step.cost !== '¥0' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">💰 票價:</span> <span>${step.cost}</span></div>` : ''}
                        ${step.transportFreq && step.transportFreq !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">🚌 班次:</span> <span>${step.transportFreq}</span></div>` : ''}
                        ${step.link && step.link !== '-' ? `<div class="flex gap-2 pt-1"><a href="${step.link}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline font-bold">🔗 交通官網/時刻表</a></div>` : ''}
                    </div>
                `;

                const attractionContent = `
                     <div class="space-y-2 text-xs text-gray-600">
                        ${step.attractionDuration && step.attractionDuration !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">⏱️ 建議停留:</span> <span>${step.attractionDuration}</span></div>` : ''}
                        ${step.attractionHours && step.attractionHours !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">🕒 營業時間:</span> <span>${step.attractionHours}</span></div>` : ''}
                        ${step.attractionPrice && step.attractionPrice !== '-' ? `<div class="flex gap-2"><span class="font-bold text-gray-500 min-w-[60px]">💰 景點費用:</span> <span>${step.attractionPrice}</span></div>` : ''}
                        ${step.attractionWebsite && step.attractionWebsite !== '-' ? `<div class="flex gap-2 pt-1"><a href="${step.attractionWebsite}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline font-bold">🌐 景點官網</a></div>` : ''}
                     </div>
                `;

                // Check availability
                const hasTransportInfo = (step.start && step.start !== '-') || (step.end && step.end !== '-') || (step.duration && step.duration !== '-') || (step.cost && step.cost !== '-' && step.cost !== '¥0') || (step.transportFreq && step.transportFreq !== '-') || (step.link && step.link !== '-');
                const hasAttractionInfo = (step.attractionDuration && step.attractionDuration !== '-') || (step.attractionHours && step.attractionHours !== '-') || (step.attractionPrice && step.attractionPrice !== '-') || (step.attractionWebsite && step.attractionWebsite !== '-');
                const hasMap = step.mapUrl;

                html += `
                    <div class="relative group bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                        <!-- Step Dot -->
                        <div class="absolute -left-[31px] top-6 w-2 h-2 bg-gray-300 rounded-full border border-white"></div>
                        
                        <div class="flex flex-col gap-2">
                            <!-- Time & Badge Row -->
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="font-mono font-bold text-gray-500 text-sm bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">${step.time || '--:--'}</span>
                                    <span class="text-xs px-2 py-0.5 rounded-full ${isTransport ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'} font-bold border border-opacity-20 border-current shadow-sm">${step.type}</span>
                                    ${step.city ? `<span class="text-xs font-bold text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded ml-1 bg-gray-50">📍 ${step.city}</span>` : ''}
                                </div>
                            </div>
                            
                            <!-- Main Content -->
                            <div>
                                <div class="text-lg text-gray-800 font-bold leading-tight">${step.event}</div>
                                <div class="text-sm text-gray-500 mt-1">${step.description || ''}</div>
                            </div>
                                
                            <!-- Alerts -->
                            ${step.specialNotes && step.specialNotes !== '-' ? `<div class="mt-2 text-xs font-bold text-red-700 bg-red-50 p-2 rounded border border-red-200 flex items-start gap-1"><span class="text-base">⚠️</span><span>${step.specialNotes}</span></div>` : ''}
                                
                            <!-- Intro (Formatted as Highlights) -->
                            ${renderAttractionHighlights(step.attractionIntro)}

                            <!-- Action Buttons -->
                            <div class="flex flex-wrap gap-2 mt-3 pt-2 border-t border-gray-50">
                `;

                // Render Buttons based on type
                if (isTransport) {
                    if (hasTransportInfo) {
                        html += `
                            <button onclick="toggleMap('${cardIdBase}-transport')" class="flex items-center gap-1 text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors">
                                查看詳情 ▼
                            </button>
                        `;
                    }
                } else {
                    // Non-Transport Items: 3 separate buttons
                    if (hasMap) {
                        html += `
                            <button onclick="toggleMap('${cardIdBase}-map')" class="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 hover:bg-blue-100 transition-colors">
                                開啟地圖 🗺️▼
                            </button>
                        `;
                    }
                    if (hasAttractionInfo) {
                        html += `
                            <button onclick="toggleMap('${cardIdBase}-attr')" class="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 hover:bg-emerald-100 transition-colors">
                                景點資訊 ℹ️▼
                            </button>
                        `;
                    }
                    if (hasTransportInfo) {
                        html += `
                            <button onclick="toggleMap('${cardIdBase}-transport')" class="flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 hover:bg-indigo-100 transition-colors">
                                交通資訊 🚇▼
                            </button>
                        `;
                    }
                }

                html += `
                            </div>

                            <!-- Detail Cards (Hidden by default) -->
                `;

                // Render Detail Sections

                // Map Section
                if (hasMap && !isTransport) { // Transport usually doesn't show map in this design unless requested, but let's stick to non-transport for map button as per request
                    html += `
                        <div id="${cardIdBase}-map" class="hidden mt-2 rounded-lg overflow-hidden shadow-inner bg-gray-100 w-full border border-gray-200">
                             <iframe class="w-full h-48 border-0" loading="lazy" src="${step.mapUrl}"></iframe>
                        </div>
                     `;
                }

                // Attraction Info Section
                if (hasAttractionInfo && !isTransport) {
                    html += `
                        <div id="${cardIdBase}-attr" class="hidden mt-2 p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                            ${attractionContent}
                        </div>
                    `;
                }

                // Transport Info Section (Used for both)
                if (hasTransportInfo) {
                    html += `
                        <div id="${cardIdBase}-transport" class="hidden mt-2 p-3 ${isTransport ? 'bg-gray-50 border-gray-200' : 'bg-indigo-50/50 border-indigo-100'} border rounded-lg">
                            ${transportContent}
                        </div>
                    `;
                }

                html += `
                        </div>
                    </div>
                `;
            });
        }

        html += `
                </div>
            </div>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

// --- Components ---

function getPeriodColor(p) {
    if (p.includes('上')) return 'teal';
    if (p.includes('下')) return 'orange';
    return 'indigo';
}

function renderAttractionHighlights(text) {
    if (!text || text === '-' || text === '') return '';

    // Smart splitting: explicitly looks for "1.", "2." OR semicolons
    let parts = [];
    if (text.match(/\d+\./)) {
        // Has numbers: split by numbers
        parts = text.split(/(?=\d+\.)/).map(s => s.replace(/^\d+\.\s*/, '').trim()).filter(s => s);
    } else {
        // No numbers: split by semicolon
        parts = text.split(/[:;]/).map(s => s.trim()).filter(s => s);
    }

    // Safety fallback
    if (parts.length === 0) return '';

    const listHtml = parts.map((part, i) => `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[10px] font-bold mt-0.5 border border-amber-200 shadow-sm">
                ${i + 1}
            </div>
            <div class="text-gray-700 text-sm leading-relaxed">${part}</div>
        </div>
    `).join('');

    return `
        <div class="mt-3 bg-amber-50/60 rounded-xl p-4 border border-amber-100/80">
            <div class="text-[10px] font-bold text-amber-500 mb-2 uppercase tracking-wide flex items-center gap-1">
                <span>✨</span> Highlights
            </div>
            <div class="space-y-2.5">
                ${listHtml}
            </div>
        </div>
    `;
}

// Override renderMapLink to renderMapButton
function renderMapButton(url) {
    const id = 'map-' + Math.random().toString(36).substr(2, 9);
    return `
        <button onclick="toggleMap('${id}')" class="flex items-center gap-1 text-xs font-bold text-blue-700 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors shadow-sm">
            📍 開啟地圖
        </button>
        <div id="${id}" class="hidden mt-2 rounded-lg overflow-hidden shadow-inner bg-gray-100 transition-all w-full border border-gray-200 w-full mb-2">
            <iframe class="w-full h-48 border-0" loading="lazy" src="${url}"></iframe>
        </div>
    `;
}

// Global scope for onclick
window.toggleMap = function (id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.toggle('hidden');
    }
};

