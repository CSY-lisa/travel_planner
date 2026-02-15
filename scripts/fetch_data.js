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
const LOCAL_CSV_PATH = path.join(__dirname, '../data/template_v2.csv');

async function runSync() {
    console.log('--- Travel Planner Sync ---');
    if (!SHEET_URL) {
        console.warn('SHEET_URL not set in .env. Skipping remote fetch.');
        handleLocalFallback();
        return;
    }

    try {
        const rawData = await getWithRedirect(SHEET_URL);
        if (rawData.length < 100) throw new Error('Received data too short (Potential Access Denied)');

        handleData(rawData);
        // Mirror to local CSV
        fs.writeFileSync(LOCAL_CSV_PATH, rawData);
        console.log(`SUCCESS: Remote sync complete.`);
    } catch (err) {
        console.error('Remote sync failed:', err.message);
        handleLocalFallback();
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
    const rows = parseCSV(rawData);
    const jsonData = processData(rows);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jsonData, null, 2));
    console.log(`PROCESSED: ${jsonData.length} days.`);
}

function handleLocalFallback() {
    console.log('Using local fallback...');
    try {
        if (!fs.existsSync(LOCAL_CSV_PATH)) throw new Error('Local file not found');
        handleData(fs.readFileSync(LOCAL_CSV_PATH, 'utf8'));
    } catch (e) {
        console.error('FATAL: Data source unavailable.', e.message);
    }
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let curVal = '';
    let inQuote = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (inQuote) {
            if (c === '"' && next === '"') { curVal += '"'; i++; }
            else if (c === '"') inQuote = false;
            else curVal += c;
        } else {
            if (c === '"') inQuote = true;
            else if (c === ',') { row.push(curVal.trim()); curVal = ''; }
            else if (c === '\r') continue;
            else if (c === '\n') {
                row.push(curVal.trim());
                if (row.length > 0) rows.push(row);
                row = []; curVal = '';
            } else curVal += c;
        }
    }
    if (curVal || row.length > 0) { row.push(curVal.trim()); rows.push(row); }
    return rows;
}

function processData(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0];
    const data = rows.slice(1);
    const idx = {};
    headers.forEach((h, i) => idx[h] = i);
    const travelData = [];
    let currentDate = null;
    let currentDayObj = null;

    data.forEach(row => {
        const date = row[idx['日期']];
        if (!date) return;
        if (date !== currentDate) {
            currentDate = date;
            currentDayObj = { date, dayOfWeek: row[idx['星期']] || '', periods: [] };
            travelData.push(currentDayObj);
        }
        const get = (col) => row[idx[col]] || '';
        const periodName = get('時段') || '全日';
        let period = currentDayObj.periods.find(p => p.period === periodName);
        if (!period) {
            period = { period: periodName, timeRange: '', timeline: [] };
            currentDayObj.periods.push(period);
        }
        period.timeline.push({
            time: get('時間'),
            type: get('類型'),
            city: get('城市'),
            event: get('活動標題'),
            description: get('內容詳情'),
            transportInfo: get('交通/票價資訊'),
            cost: get('費用') !== '-' ? get('費用') : null,
            link: get('相關連結(官網/時刻表)'),
            mapUrl: getMapUrl(get('地點/導航')),
            start: get('起始站'),
            end: get('終點站'),
            duration: get('移動時間'),
            transportFreq: get('班次頻率/時刻資訊'),
            attractionWebsite: get('景點官網'),
            attractionPrice: get('景點票價 (JPY)'),
            attractionHours: get('營業時間/狀態'),
            attractionIntro: get('景點簡介'),
            attractionDuration: get('景點建議停留時間'),
            specialNotes: get('景點特殊狀況')
        });
    });
    return travelData;
}

function getMapUrl(location) {
    if (!location || location.trim() === '-' || location.trim() === '') return null;
    return `https://maps.google.com/maps?q=${encodeURIComponent(location.trim())}&output=embed`;
}

runSync();
