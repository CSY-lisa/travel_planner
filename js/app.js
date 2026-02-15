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

function renderOverview(container) {
    let html = `
        <div class="animate-fade-in p-4">
            <h2 class="text-xl font-bold text-gray-800 mb-4">行程總覽 (Overview)</h2>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
    `;

    travelData.forEach((day, index) => {
        // Extract main locations/events for preview
        const highlights = day.periods.flatMap(p => p.timeline.map(t => t.event)).slice(0, 3).join(' • ');

        html += `
            <a href="#day${index + 1}" class="block bg-white p-3 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-all">
                <div class="text-xs font-bold text-teal-600 mb-1">Day ${index + 1} (${day.date.slice(5)} ${day.dayOfWeek})</div>
                <div class="text-sm font-bold text-gray-800 line-clamp-2">${highlights || '自由活動'}</div>
                <div class="mt-2 text-xs text-gray-400 text-right">查看更多 →</div>
            </a>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

function renderDailyView(container, dayIndex) {
    const day = travelData[dayIndex];
    if (!day) return;

    let html = `
        <div class="animate-fade-in pb-12">
            <!-- Header -->
            <div class="bg-teal-50 border-l-4 border-teal-500 p-4 mb-6 rounded-r shadow-sm mx-4 mt-4">
                <h2 class="font-bold text-lg text-teal-800">Day ${dayIndex + 1}: ${day.date} (${day.dayOfWeek})</h2>
                <p class="text-sm text-teal-600">本日行程詳情</p>
            </div>
            
            <div class="px-4 space-y-8">
    `;

    // Render Periods
    day.periods.forEach(period => {
        const periodColor = getPeriodColor(period.period); // teal/orange/indigo

        html += `
            <div class="relative pl-6 border-l-2 border-gray-200 ml-2">
                <!-- Period Label -->
                <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-${periodColor}-500 border-2 border-white z-10"></div>
                <span class="text-xs font-bold text-${periodColor}-600 bg-${periodColor}-100 px-2 py-0.5 rounded mb-2 inline-block">
                    ${period.period} ${period.timeRange || ''}
                </span>

                <!-- Timeline Steps -->
                <div class="space-y-6 mt-2">
        `;

        // Render extracted sub-steps
        if (period.timeline && period.timeline.length > 0) {
            period.timeline.forEach((step, stepIndex) => {
                const isTransport = step.type === '交通';
                const cardId = 'detail-' + Math.random().toString(36).substr(2, 9);

                html += `
                    <div class="relative group">
                        <!-- Step Dot -->
                        <div class="w-2 h-2 bg-gray-300 rounded-full absolute -left-[31px] top-2 border border-white"></div>
                        
                        <div class="flex items-start">
                            <div class="font-bold text-gray-800 text-sm w-12 flex-shrink-0 pt-0.5">${step.time || ''}</div>
                            <div class="flex-1">
                                <div class="flex items-center gap-2">
                                    <span class="text-xs px-1.5 py-0.5 rounded ${isTransport ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'} font-bold">${step.type}</span>
                                    ${step.city ? `<span class="text-xs font-bold text-gray-400">[${step.city}]</span>` : ''}
                                    <div class="text-base text-gray-800 font-bold">${step.event}</div>
                                </div>
                                <div class="text-sm text-gray-500 mt-1">${step.description || ''}</div>
                                
                                ${step.specialNotes && step.specialNotes !== '-' ? `<div class="mt-2 text-xs font-bold text-red-600 bg-red-50 p-2 rounded border border-red-100 animate-pulse">⚠️ 注意: ${step.specialNotes}</div>` : ''}
                                
                                ${step.attractionIntro && step.attractionIntro !== '-' ? `<div class="mt-2 text-xs text-gray-600 italic bg-gray-50 p-2 rounded border-l-2 border-gray-200">${step.attractionIntro}</div>` : ''}

                                <div class="flex flex-wrap gap-2 mt-2">
                                    ${step.mapUrl ? renderMapLink(step.mapUrl) : ''}
                                    ${(step.attractionPrice || step.attractionHours || step.transportFreq || step.attractionDuration || (step.start && step.start !== '-')) ?
                        `<button onclick="toggleMap('${cardId}')" class="text-xs text-teal-600 underline mt-1 hover:text-teal-800 flex items-center">
                                            ℹ️ 詳情
                                        </button>` : ''}
                                </div>

                                <!-- Detail Card (Hidden by default) -->
                                <div id="${cardId}" class="hidden mt-3 p-3 bg-white border border-gray-100 rounded-lg shadow-sm space-y-2 text-xs">
                                    ${step.attractionDuration && step.attractionDuration !== '-' ? `<div><span class="font-bold text-gray-400">🕒 建議停留:</span> ${step.attractionDuration}</div>` : ''}
                                    ${step.attractionHours && step.attractionHours !== '-' ? `<div><span class="font-bold text-gray-400">🕒 營業時間:</span> ${step.attractionHours}</div>` : ''}
                                    ${step.attractionPrice && step.attractionPrice !== '-' ? `<div><span class="font-bold text-gray-400">💰 費用/門票:</span> ${step.attractionPrice}</div>` : ''}
                                    ${step.start && step.start !== '-' ? `<div><span class="font-bold text-gray-400">📍 起點:</span> ${step.start}</div>` : ''}
                                    ${step.end && step.end !== '-' ? `<div><span class="font-bold text-gray-400">🏁 終點:</span> ${step.end}</div>` : ''}
                                    ${step.duration && step.duration !== '-' ? `<div><span class="font-bold text-gray-400">⏱️ 移動時間:</span> ${step.duration}</div>` : ''}
                                    ${step.transportFreq && step.transportFreq !== '-' ? `<div><span class="font-bold text-gray-400">🚌 班次資訊:</span> ${step.transportFreq}</div>` : ''}
                                    ${step.attractionWebsite && step.attractionWebsite !== '-' ? `<a href="${step.attractionWebsite}" target="_blank" class="block text-blue-500 hover:underline">🔗 官方網站</a>` : ''}
                                    ${step.link && step.link !== '-' && step.link !== step.attractionWebsite ? `<a href="${step.link}" target="_blank" class="block text-blue-500 hover:underline">🔗 相關連結</a>` : ''}
                                </div>
                            </div>
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

function renderMapLink(url) {
    const id = 'map-' + Math.random().toString(36).substr(2, 9);
    return `
        <button onclick="toggleMap('${id}')" class="text-xs text-blue-500 underline mt-1 hover:text-blue-700 flex items-center">
            📍 地圖
        </button>
        <div id="${id}" class="hidden mt-2 rounded-lg overflow-hidden shadow-inner bg-gray-100 transition-all w-full">
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

