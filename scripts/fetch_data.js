const https = require('https');
const fs = require('fs');
const path = require('path');

// 1. Improved ENV parsing
const dotenvPath = path.join(__dirname, '../.env');
if (fs.existsSync(dotenvPath)) {
    const dotenvContent = fs.readFileSync(dotenvPath, 'utf8');
    dotenvContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...valParts] = trimmed.split('=');
        const value = valParts.join('=').trim();
        if (key && value) process.env[key.trim()] = value;
    });
}

const SHEET_URL = process.env.SHEET_URL;
const OUTPUT_PATH = path.join(__dirname, '../data/travel_data.json');
const LOCAL_TSV_PATH = path.join(__dirname, '../data/itinerary_final.tsv');

async function runSync() {
    console.log('--- Travel Planner Sync (Robust TSV) ---');
    try {
        if (fs.existsSync(LOCAL_TSV_PATH)) {
            console.log(`Reading from local TSV: ${LOCAL_TSV_PATH}`);
            const rawData = fs.readFileSync(LOCAL_TSV_PATH, 'utf8');
            handleData(rawData);
            console.log('SUCCESS: Local TSV processed.');
        } else if (SHEET_URL) {
            console.log('Local TSV not found. Fetching from Sheet...');
            const rawData = await getWithRedirect(SHEET_URL);
            handleData(rawData);
            console.log('SUCCESS: Remote sync complete.');
        } else {
            console.warn('Neither local TSV nor SHEET_URL found.');
        }
    } catch (err) {
        console.error('Sync failed:', err.message);
    }
}

function getWithRedirect(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(getWithRedirect(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP Status ${res.statusCode}`));
                return;
            }
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

function handleData(rawData) {
    const rows = parseTSV(rawData);
    const jsonData = processData(rows);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jsonData, null, 2));
    console.log(`PROCESSED: ${jsonData.length} days.`);
}

/**
 * Robust TSV Parser
 * Handles quoted values containing tabs and newlines.
 */
function parseTSV(text) {
    const rows = [];
    let row = [];
    let curVal = '';
    let inQuote = false;

    // Remove BOM
    text = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];

        if (inQuote) {
            if (c === '"' && next === '"') {
                curVal += '"'; // Escaped quote "" -> "
                i++;
            } else if (c === '"') {
                inQuote = false;
            } else {
                curVal += c; // Literal character inside quotes (including \n and \t)
            }
        } else {
            if (c === '"') {
                inQuote = true;
            } else if (c === '\t') {
                row.push(curVal.trim());
                curVal = '';
            } else if (c === '\r') {
                continue; // Skip CR
            } else if (c === '\n') {
                row.push(curVal.trim());
                if (row.length > 0) rows.push(row);
                row = [];
                curVal = '';
            } else {
                curVal += c;
            }
        }
    }

    // Last row/value
    if (curVal !== '' || row.length > 0) {
        row.push(curVal.trim());
        rows.push(row);
    }

    return rows;
}

function processData(rows) {
    if (rows.length < 2) return [];

    const headers = rows[0];
    const data = rows.slice(1);

    const idx = {};
    headers.forEach((h, i) => idx[h] = i);

    const get = (row, col) => {
        const val = row[idx[col]];
        return (val === undefined || val === null) ? '' : val;
    };

    // First pass: collect all rows with metadata
    const allItems = [];
    data.forEach(row => {
        const date = get(row, '日期');
        if (!date || date === '日期') return;

        allItems.push({
            date,
            dayOfWeek: get(row, '星期'),
            period: get(row, '時段') || '全日',
            groupId: get(row, '群組ID'),
            time: get(row, '時間'),
            type: get(row, '類型'),
            city: get(row, '城市'),
            event: get(row, '活動標題'),
            description: get(row, '內容詳情'),
            transportType: get(row, '交通工具'),
            transportPayment: get(row, '交通支付方式'),
            mapUrl: getMapUrl(get(row, '地點/導航')),
            link: get(row, '相關連結(時刻表)'),
            start: get(row, '起始站'),
            end: get(row, '終點站'),
            transportFreq: get(row, '班次頻率/時刻資訊'),
            duration: get(row, '移動時間'),
            cost: get(row, '交通費用(JPY)'),
            attractionWebsite: get(row, '景點官網'),
            attractionPrice: get(row, '景點票價 (JPY)'),
            attractionHours: get(row, '營業時間/狀態'),
            attractionIntro: get(row, '景點簡介'),
            attractionDuration: get(row, '景點建議停留時間'),
            specialNotes: get(row, '景點特殊狀況')
        });
    });

    // Second pass: merge grouped rows (alternative transport methods)
    const mergedItems = [];
    const groupSeen = {}; // groupId -> index in mergedItems

    allItems.forEach(item => {
        // item.groupId is '' (falsy) for rows without a group — they go to else branch
        if (item.groupId && groupSeen[item.groupId] !== undefined) {
            // Append as alternative transport to the existing item
            const existing = mergedItems[groupSeen[item.groupId]];
            if (!existing.transportAlternatives) existing.transportAlternatives = [];
            existing.transportAlternatives.push({
                transportType: item.transportType,
                transportPayment: item.transportPayment,
                start: item.start,
                end: item.end,
                transportFreq: item.transportFreq,
                duration: item.duration,
                cost: item.cost,
                link: item.link
            });
        } else {
            if (item.groupId) groupSeen[item.groupId] = mergedItems.length; // index of item about to be pushed
            mergedItems.push(item);
        }
    });

    // Third pass: build day/period structure
    const travelData = [];
    let currentDate = null;
    let currentDayObj = null;

    mergedItems.forEach(item => {
        if (item.date !== currentDate) {
            currentDate = item.date;
            currentDayObj = {
                date: item.date,
                dayOfWeek: item.dayOfWeek || '',
                periods: []
            };
            travelData.push(currentDayObj);
        }

        let period = currentDayObj.periods.find(p => p.period === item.period);
        if (!period) {
            period = { period: item.period, timeRange: '', timeline: [] };
            currentDayObj.periods.push(period);
        }

        const { date, dayOfWeek, period: _p, groupId, ...rest } = item;
        period.timeline.push(rest);
    });

    return travelData;
}

function getMapUrl(location) {
    if (!location || location.trim() === '-' || location.trim() === '') return null;
    // Prepend the required embed prefix as per the app's iframe requirement
    return `https://maps.google.com/maps?q=${location.trim()}&output=embed`;
}

runSync();
