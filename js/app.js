// JS/app.js

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});

let travelData = [];
let referenceData = [];
let referenceActiveCategory = '全部';
let referenceSearchQuery = '';
let referenceCityFilter = '全部';
let jpyToTwd = null; // TWD per 1 JPY, fetched live
let exchangeRateHistory = []; // [{date, rate}] loaded from JSON
function parseCostJPY(str) {
    if (!str || str === '-' || str === '') return 0;
    // Extract first number sequence, ignore trailing text like "(單程)"
    const match = str.replace(/,/g, '').match(/\d+/);
    return match ? parseInt(match[0]) : 0;
}

function parseDurMin(s) {
    if (!s || s === '-') return Infinity;
    let m = 0;
    const h = s.match(/(\d+)\s*小時/); if (h) m += parseInt(h[1]) * 60;
    const min = s.match(/(\d+)\s*分/); if (min) m += parseInt(min[1]);
    return m || Infinity;
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fix double-wrapped map URLs stored in JSON (e.g. ?q=https://maps.google.com/...&output=embed&output=embed)
// Strategy: remove the trailing &output=embed that getMapUrl() appended to an already-complete URL,
// then check if the q= value is itself a URL — if so, return it (the real inner embed URL).
function sanitizeMapUrl(url) {
    if (!url) return null;
    const qIdx = url.indexOf('?q=');
    if (qIdx !== -1) {
        const rawVal = url.slice(qIdx + 3).replace(/&output=embed$/, '');
        const decoded = decodeURIComponent(rawVal);
        if (/^https?:\/\//i.test(decoded)) return decoded;
    }
    return url;
}

function extractCosts() {
    const transport = [];
    const attraction = [];

    travelData.forEach((day, dayIdx) => {
        (day.periods || []).forEach(period => {
            (period.timeline || []).forEach(item => {
                // Transport: merge primary + alternatives, pick shortest duration
                const allOptions = [
                    { cost: item.cost, duration: item.duration, transportType: item.transportType },
                    ...(item.transportAlternatives || [])
                ];
                const validOptions = allOptions.filter(o => parseCostJPY(o.cost) > 0);
                if (validOptions.length > 0) {
                    const sorted = [...validOptions].sort((a, b) => parseDurMin(a.duration) - parseDurMin(b.duration));
                    const best = sorted[0];
                    transport.push({
                        date: day.date,
                        event: item.event,
                        cost: parseCostJPY(best.cost),
                        transportType: best.transportType || '',
                        dayIndex: dayIdx + 1
                    });
                }

                // Attraction costs (unchanged)
                const ac = parseCostJPY(item.attractionPrice);
                if (ac > 0) {
                    attraction.push({ date: day.date, event: item.event, cost: ac, city: item.city || '' });
                }
            });
        });
    });

    return { transport, attraction };
}

async function fetchLiveRate() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/JPY');
        if (!res.ok) throw new Error('rate fetch failed');
        const data = await res.json();
        jpyToTwd = data.rates && data.rates.TWD ? data.rates.TWD : null;
    } catch (e) {
        console.warn('Live rate unavailable:', e.message);
        // fallback: use last entry from history
        if (exchangeRateHistory.length > 0) {
            jpyToTwd = exchangeRateHistory[exchangeRateHistory.length - 1].rate;
        }
    }
}

async function fetchData() {
    try {
        const [travelRes, referenceRes, rateRes] = await Promise.allSettled([
            fetch('data/travel_data.json'),
            fetch('data/reference_data.json'),
            fetch('data/exchange_rate_history.json')
        ]);

        if (travelRes.status === 'fulfilled' && travelRes.value.ok) {
            travelData = await travelRes.value.json();
        } else {
            console.error('Failed to load travel data');
        }

        if (referenceRes.status === 'fulfilled' && referenceRes.value.ok) {
            referenceData = await referenceRes.value.json();
        } else {
            console.warn('reference_data.json not found – reference page will be empty');
        }

        if (rateRes.status === 'fulfilled' && rateRes.value.ok) {
            exchangeRateHistory = await rateRes.value.json();
        } else {
            console.warn('exchange_rate_history.json not found');
        }

        // Try live rate fetch (non-blocking — initApp runs regardless)
        fetchLiveRate();

        initApp();
    } catch (error) {
        console.error('Error loading data:', error);
        document.body.innerHTML = '<div class="p-4 text-red-500">Failed to load itinerary data.</div>';
    }
}

function updateNavDayLabels() {
    travelData.forEach((day, i) => {
        const btn = document.querySelector(`[data-target="day${i + 1}"]`);
        if (!btn) return;
        const [, m, d] = day.date.split('/');
        btn.textContent = `${parseInt(m)}/${parseInt(d)}(${day.dayOfWeek})`;
    });
}

function initApp() {
    updateNavDayLabels();
    // Determine view based on URL hash or default
    handleRouting();
    window.addEventListener('hashchange', handleRouting);
}

function handleRouting() {
    const hash = window.location.hash;
    const mainContent = document.getElementById('main-content');
    const dayNav = document.getElementById('nav-container');

    // Day nav: only visible on itinerary tab
    if (hash === '#reference' || hash === '#budget' || hash === '#rate') {
        dayNav.style.display = 'none';
    } else {
        dayNav.style.display = '';
    }

    if (!hash || hash === '#overview') {
        renderOverview(mainContent);
        updateNavState('overview');
        updateTabState('itinerary');
    } else if (hash.startsWith('#day')) {
        const dayIndex = parseInt(hash.replace('#day', '')) - 1;
        if (travelData[dayIndex]) {
            renderDailyView(mainContent, dayIndex);
            updateNavState(`day${dayIndex + 1}`);
            updateTabState('itinerary');
        }
    } else if (hash === '#reference') {
        renderReferenceView(mainContent);
        updateTabState('reference');
    } else if (hash === '#budget') {
        renderBudgetView(mainContent);
        updateTabState('budget');
    } else if (hash === '#rate') {
        renderRateView(mainContent);
        updateTabState('rate');
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

function updateTabState(activeTab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('text-teal-600', 'font-bold');
        btn.classList.add('text-gray-400', 'font-medium');
    });
    const activeBtn = document.getElementById(`tab-${activeTab}`);
    if (activeBtn) {
        activeBtn.classList.remove('text-gray-400', 'font-medium');
        activeBtn.classList.add('text-teal-600', 'font-bold');
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
                // Build transport method blocks (primary + alternatives)
                const primaryHasData = step.transportType || step.start || step.end || step.duration || step.cost;
                const allTransportMethods = [
                    ...(primaryHasData ? [{
                        transportType: step.transportType,
                        start: step.start,
                        end: step.end,
                        duration: step.duration,
                        cost: step.cost,
                        transportFreq: step.transportFreq,
                        link: step.link
                    }] : []),
                    ...(step.transportAlternatives || [])
                ];

                const hasMultipleMethods = allTransportMethods.length > 1;

                // Sort by duration ascending (shortest = fastest = method 1)
                const parseDurMin = (s) => {
                    if (!s || s === '-') return Infinity;
                    let m = 0;
                    const h = s.match(/(\d+)\s*小時/); if (h) m += parseInt(h[1]) * 60;
                    const min = s.match(/(\d+)\s*分/); if (min) m += parseInt(min[1]);
                    return m || Infinity;
                };
                const sortedMethods = hasMultipleMethods
                    ? [...allTransportMethods].sort((a, b) => parseDurMin(a.duration) - parseDurMin(b.duration))
                    : allTransportMethods;

                const renderTransportMethod = (m, index) => `
                    <div class="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                        ${hasMultipleMethods ? `
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">方法 ${index + 1}</span>
                            ${index === 0 ? `<span class="text-[10px] font-bold text-amber-600 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">⚡ 最快</span>` : ''}
                        </div>` : ''}
                        ${m.transportType && m.transportType !== '-' ? `<div class="font-bold text-teal-700 text-xs mb-2">${escHtml(m.transportType)}</div>` : ''}
                        <div class="space-y-1 text-xs text-gray-600">
                            ${m.duration && m.duration !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">移動時間</span><span class="font-bold text-gray-700">⏱️ ${escHtml(m.duration)}</span></div>` : ''}
                            ${m.start && m.start !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">起站</span><span>📍 ${escHtml(m.start)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.start + (step.city && step.city !== '-' ? ' ' + step.city : ''))}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 ml-1">🗺️</a></span></div>` : ''}
                            ${m.end && m.end !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">迄站</span><span>🏁 ${escHtml(m.end)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.end + (step.city && step.city !== '-' ? ' ' + step.city : ''))}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 ml-1">🗺️</a></span></div>` : ''}
                            ${m.transportFreq && m.transportFreq !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">班次</span><span>🚌 ${escHtml(m.transportFreq)}</span></div>` : ''}
                            ${m.cost && m.cost !== '-' && m.cost !== '¥0' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">票價</span><span class="font-bold text-gray-800">💰 ${escHtml(m.cost)}</span></div>` : ''}
                            ${m.link && m.link !== '-' && /^https?:\/\//i.test(m.link) ? `<div class="flex gap-2 pt-1"><span class="text-gray-400 w-14 flex-shrink-0">官網資訊</span><a href="${escHtml(m.link)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline font-bold">🔗 官網資訊</a></div>` : ''}
                        </div>
                    </div>
                `;

                const transportContent = `
                    <div class="space-y-3">
                        ${sortedMethods.map((m, i) => renderTransportMethod(m, i)).join('')}
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
                                交通資訊🚇 ▼
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
                             <iframe class="w-full h-48 border-0" loading="lazy" src="${escHtml(sanitizeMapUrl(step.mapUrl))}"></iframe>
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

function renderBudgetView(container) {
    const { transport, attraction } = extractCosts();

    const transportTotal = transport.reduce((sum, x) => sum + x.cost, 0);
    const attractionTotal = attraction.reduce((sum, x) => sum + x.cost, 0);
    const grandTotal = transportTotal + attractionTotal;

    const fmtJPY = (n) => '¥' + n.toLocaleString('ja-JP');
    const fmtTWD = (n) => jpyToTwd ? `NT$${Math.round(n * jpyToTwd).toLocaleString()}` : '';

    const renderTransportRows = (items) => {
        let dayBg = 'bg-white';
        let lastDate = null;
        return items.map(x => {
            if (x.date !== lastDate) {
                lastDate = x.date;
                dayBg = dayBg === 'bg-white' ? 'bg-gray-50' : 'bg-white';
            }
            return `
        <tr class="${dayBg} border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
            onclick="location.hash='#day${x.dayIndex}'">
          <td class="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3">
            <div class="text-sm text-gray-700">${escHtml(x.event)}</div>
            ${x.transportType ? `<div class="text-xs text-gray-400 mt-0.5">🚌 ${escHtml(x.transportType)}</div>` : ''}
          </td>
          <td class="py-2 px-3 text-right">
            <div class="text-sm font-bold text-gray-800">${fmtJPY(x.cost)}</div>
            ${fmtTWD(x.cost) ? `<div class="text-xs text-gray-400">${fmtTWD(x.cost)}</div>` : ''}
          </td>
        </tr>`;
        }).join('');
    };

    const renderAttractionRows = (items) => {
        let dayBg = 'bg-white';
        let lastDate = null;
        return items.map(x => {
            if (x.date !== lastDate) {
                lastDate = x.date;
                dayBg = dayBg === 'bg-white' ? 'bg-gray-50' : 'bg-white';
            }
            return `
        <tr class="${dayBg} border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 px-3 text-xs text-gray-500">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3 text-xs text-gray-400">${escHtml(x.city || '-')}</td>
          <td class="py-2 px-3 text-sm text-gray-700">${escHtml(x.event)}</td>
          <td class="py-2 px-3 text-right">
            <div class="text-sm font-bold text-gray-800">${fmtJPY(x.cost)}</div>
            ${fmtTWD(x.cost) ? `<div class="text-xs text-gray-400">${fmtTWD(x.cost)}</div>` : ''}
          </td>
        </tr>`;
        }).join('');
    };

    container.innerHTML = `
    <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-6">
      <h2 class="text-xl font-bold text-gray-800">💰 費用總覽</h2>
      ${jpyToTwd ? `<div class="text-xs text-gray-400 text-right">匯率參考：1 JPY = NT$${jpyToTwd.toFixed(3)}</div>` : ''}

      <!-- Summary Cards -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition-shadow" onclick="document.getElementById('budget-transport-section').scrollIntoView({behavior:'smooth'})">
          <div class="text-xs text-blue-500 font-bold mb-1">🚆 交通</div>
          <div class="text-lg font-bold text-blue-700">${fmtJPY(transportTotal)}</div>
          ${fmtTWD(transportTotal) ? `<div class="text-xs text-blue-400">${fmtTWD(transportTotal)}</div>` : ''}
        </div>
        <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition-shadow" onclick="document.getElementById('budget-attraction-section').scrollIntoView({behavior:'smooth'})">
          <div class="text-xs text-emerald-500 font-bold mb-1">🏯 景點</div>
          <div class="text-lg font-bold text-emerald-700">${fmtJPY(attractionTotal)}</div>
          ${fmtTWD(attractionTotal) ? `<div class="text-xs text-emerald-400">${fmtTWD(attractionTotal)}</div>` : ''}
        </div>
        <div class="bg-teal-600 rounded-xl p-4 text-center shadow-md">
          <div class="text-xs text-teal-100 font-bold mb-1">🎯 合計</div>
          <div class="text-lg font-bold text-white">${fmtJPY(grandTotal)}</div>
          ${fmtTWD(grandTotal) ? `<div class="text-xs text-teal-200">${fmtTWD(grandTotal)}</div>` : ''}
        </div>
      </div>

      <!-- Transport Detail Table -->
      <div id="budget-transport-section">
        <h3 class="text-sm font-bold text-gray-600 mb-2 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> 交通費用明細
          <span class="text-xs text-gray-400 font-normal">（點擊查看行程）</span>
        </h3>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
            </thead>
            <tbody>${renderTransportRows(transport)}</tbody>
            <tfoot class="bg-blue-50 border-t border-blue-100">
              <tr>
                <td colspan="2" class="py-2 px-3 text-xs font-bold text-blue-700">小計</td>
                <td class="py-2 px-3 text-right">
                  <div class="text-sm font-bold text-blue-700">${fmtJPY(transportTotal)}</div>
                  ${fmtTWD(transportTotal) ? `<div class="text-xs text-blue-400">${fmtTWD(transportTotal)}</div>` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Attraction Detail Table -->
      <div id="budget-attraction-section">
        <h3 class="text-sm font-bold text-gray-600 mb-2 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> 景點費用明細
        </h3>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">城市</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
            </thead>
            <tbody>${renderAttractionRows(attraction)}</tbody>
            <tfoot class="bg-emerald-50 border-t border-emerald-100">
              <tr>
                <td colspan="3" class="py-2 px-3 text-xs font-bold text-emerald-700">小計</td>
                <td class="py-2 px-3 text-right">
                  <div class="text-sm font-bold text-emerald-700">${fmtJPY(attractionTotal)}</div>
                  ${fmtTWD(attractionTotal) ? `<div class="text-xs text-emerald-400">${fmtTWD(attractionTotal)}</div>` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderRateView(container) {
    const history = exchangeRateHistory.slice(-7); // last 7 entries
    const currentRate = jpyToTwd;
    const rates = history.map(h => h.rate);
    const maxRate = rates.length ? Math.max(...rates).toFixed(4) : '-';
    const minRate = rates.length ? Math.min(...rates).toFixed(4) : '-';
    const avgRate = rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(4) : '-';
    const lastUpdated = history.length ? history[history.length - 1].date : '---';

    container.innerHTML = `
        <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-6">
            <h2 class="text-xl font-bold text-gray-800">💴 日圓匯率</h2>

            <!-- Current Rate -->
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
                ${currentRate
                    ? `<div class="text-4xl font-bold text-teal-700 mb-1">NT$ ${currentRate.toFixed(3)}</div>
                       <div class="text-sm text-gray-400">每 1 JPY · 更新：${escHtml(lastUpdated)}</div>`
                    : `<div class="text-2xl font-bold text-gray-400 mb-1">載入中...</div>
                       <div class="text-sm text-gray-400">正在取得最新匯率</div>`
                }
            </div>

            <!-- Stats -->
            ${rates.length ? `
            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="bg-red-50 border border-red-100 rounded-xl p-3">
                    <div class="text-xs text-red-400 font-bold mb-1">📈 最高</div>
                    <div class="text-lg font-bold text-red-600">${maxRate}</div>
                </div>
                <div class="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <div class="text-xs text-blue-400 font-bold mb-1">📉 最低</div>
                    <div class="text-lg font-bold text-blue-600">${minRate}</div>
                </div>
                <div class="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <div class="text-xs text-gray-400 font-bold mb-1">➖ 平均</div>
                    <div class="text-lg font-bold text-gray-600">${avgRate}</div>
                </div>
            </div>` : ''}

            <!-- Chart -->
            ${rates.length >= 2 ? `
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div class="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-teal-400 inline-block"></span> 近 ${rates.length} 天趨勢
                </div>
                <canvas id="rate-chart" height="200"></canvas>
            </div>` : `
            <div class="text-center text-gray-400 py-8 text-sm">累積 2 天以上資料後顯示趨勢圖</div>`}
        </div>
    `;

    // Render chart after DOM update
    if (rates.length >= 2) {
        const ctx = document.getElementById('rate-chart');
        if (ctx && window.Chart) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: history.map(h => h.date.slice(5)), // MM-DD
                    datasets: [{
                        data: rates,
                        borderColor: '#0d9488',
                        backgroundColor: 'rgba(13, 148, 136, 0.08)',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#0d9488',
                        tension: 0.3,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            ticks: { callback: v => 'NT$' + v.toFixed(3) },
                            grid: { color: '#f3f4f6' }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
}

function getCategoryCardStyle(cat) {
    // card / badge / cityBadge — all different color families for contrast
    switch (cat) {
        case '交通': return {
            card:       'bg-sky-50 border-sky-100',
            badge:      'bg-indigo-100 text-indigo-700',
            cityBadge:  'bg-emerald-100 text-emerald-700 border-emerald-200',
            divider:    'border-sky-300'
        };
        case '餐廳': return {
            card:       'bg-orange-50 border-orange-100',
            badge:      'bg-violet-100 text-violet-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-orange-300'
        };
        case '景點': return {
            card:       'bg-emerald-50 border-emerald-100',
            badge:      'bg-indigo-100 text-indigo-700',
            cityBadge:  'bg-amber-100 text-amber-700 border-amber-200',
            divider:    'border-emerald-300'
        };
        case '住宿': return {
            card:       'bg-violet-50 border-violet-100',
            badge:      'bg-amber-100 text-amber-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-violet-300'
        };
        case '購物': return {
            card:       'bg-amber-50 border-amber-100',
            badge:      'bg-teal-100 text-teal-700',
            cityBadge:  'bg-indigo-100 text-indigo-700 border-indigo-200',
            divider:    'border-amber-300'
        };
        default:     return {
            card:       'bg-slate-50 border-slate-100',
            badge:      'bg-teal-100 text-teal-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-slate-200'
        };
    }
}

function renderReferenceView(container) {
    const categories = ['全部', ...new Set(referenceData.map(x => x.category).filter(Boolean))];

    const q = referenceSearchQuery.toLowerCase().trim();
    const filtered = referenceData.filter(x => {
        const catMatch = referenceActiveCategory === '全部' || x.category === referenceActiveCategory;
        const cityMatch = referenceCityFilter === '全部' || x.city === referenceCityFilter;
        const nameMatch = !q || (x.name || '').toLowerCase().includes(q);
        return catMatch && cityMatch && nameMatch;
    });

    const catTabs = categories.map(cat => `
        <button onclick="setReferenceCategory('${escHtml(cat)}')"
            class="flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-bold transition-all ${cat === referenceActiveCategory
            ? 'bg-teal-600 text-white shadow-md'
            : 'bg-white text-gray-600 border border-gray-300'
        }">
            ${escHtml(cat)}
        </button>
    `).join('');

    // City filter — only render if there are 2+ unique cities
    const allCities = [...new Set(referenceData.map(x => x.city).filter(Boolean))];
    const cityTabs = allCities.length >= 2 ? ['全部', ...allCities].map(city => `
        <button onclick="setReferenceCity('${escHtml(city)}')"
            class="flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all ${city === referenceCityFilter
            ? 'bg-indigo-600 text-white shadow-md'
            : 'bg-white text-gray-500 border border-gray-300'
        }">
            📍 ${escHtml(city)}
        </button>
    `).join('') : '';

    const cards = filtered.length === 0
        ? '<div class="col-span-2 text-center text-gray-400 py-12">找不到符合的資料 🔍</div>'
        : filtered.map((item, idx) => {
            const style = getCategoryCardStyle(item.category);
            return `
            <div class="${style.card} rounded-xl shadow-sm border p-4 space-y-3 hover:shadow-md transition-shadow">
                <!-- Name Row: city icon + name + category badge -->
                <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2 flex-wrap min-w-0">
                        ${item.city && item.city !== '-' ? `<span class="flex-shrink-0 text-[10px] font-bold ${style.cityBadge} border px-1.5 py-0.5 rounded-full">📍 ${escHtml(item.city)}</span>` : ''}
                        <h3 class="font-bold text-gray-800 text-base leading-tight">${escHtml(item.name)}</h3>
                    </div>
                    <span class="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}">${escHtml(item.category)}</span>
                </div>

                <!-- Description -->
                <p class="text-sm text-gray-600 leading-relaxed">${escHtml(item.description)}</p>

                <!-- Notes -->
                ${item.notes ? `<p class="text-xs text-gray-500 bg-white/70 rounded-lg p-2 border border-white">${escHtml(item.notes)}</p>` : ''}

                <!-- Links Row -->
                <div class="flex gap-3 flex-wrap pt-1 border-t ${style.divider}">
                    ${item.website && /^https?:\/\//i.test(item.website) ? `<a href="${escHtml(item.website)}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-blue-600 hover:underline">🌐 官網</a>` : ''}
                    ${item.mapUrl ? `<button onclick="toggleMap('ref-map-${idx}')" class="text-xs font-bold text-emerald-600 hover:underline">📍 地圖 ▼</button>` : ''}
                </div>

                <!-- Map Embed (hidden by default) -->
                ${item.mapUrl ? `
                    <div id="ref-map-${idx}" class="hidden rounded-lg overflow-hidden border border-gray-200">
                        <iframe class="w-full h-40 border-0" loading="lazy" src="${escHtml(sanitizeMapUrl(item.mapUrl))}"></iframe>
                    </div>
                ` : ''}
            </div>
        `}).join('');

    container.innerHTML = `
        <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-5">
            <h2 class="text-xl font-bold text-gray-800">📋 補充資料</h2>

            <!-- Search + Category Filters -->
            <div class="space-y-2">
                <input type="text"
                    id="ref-search-input"
                    placeholder="搜尋名稱..."
                    value="${escHtml(referenceSearchQuery)}"
                    class="w-full border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white shadow-sm">
                <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    ${catTabs}
                </div>
                ${cityTabs ? `<div class="flex gap-2 overflow-x-auto no-scrollbar pb-1">${cityTabs}</div>` : ''}
            </div>

            <!-- Card Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${cards}
            </div>
        </div>
    `;
    attachRefSearchListeners();
}

function attachRefSearchListeners() {
    const inp = document.getElementById('ref-search-input');
    if (!inp) return;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);

    let isComposing = false;
    inp.addEventListener('compositionstart', () => { isComposing = true; });
    inp.addEventListener('compositionend', (e) => {
        isComposing = false;
        window.setReferenceSearch(e.target.value);
    });
    inp.addEventListener('input', (e) => {
        if (!isComposing) window.setReferenceSearch(e.target.value);
    });
}

window.setReferenceCategory = function (cat) {
    referenceActiveCategory = cat;
    const mainContent = document.getElementById('main-content');
    renderReferenceView(mainContent);
};

window.setReferenceSearch = function (val) {
    referenceSearchQuery = val;
    const mainContent = document.getElementById('main-content');
    renderReferenceView(mainContent);
    // attachRefSearchListeners is called inside renderReferenceView
};

window.setReferenceCity = function (city) {
    referenceCityFilter = city;
    const mainContent = document.getElementById('main-content');
    renderReferenceView(mainContent);
};
