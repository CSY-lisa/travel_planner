# Travel Planner Project Rules (GEMINI.md)

## 📌 Project Overview
A serverless, automated travel itinerary application that syncs data from Google Sheets and renders a mobile-first, responsive web interface via GitHub Pages.

## 🛠 Technology Stack
- **Frontend**: Vanilla HTML5, Tailwind CSS (via CDN), Vanilla JavaScript.
- **Data Source**: Google Sheets (exported via CSV).
- **Automation**: GitHub Actions (Node.js) to fetch data daily.
- **Hosting**: GitHub Pages.

## 📁 Key File Structure
- `index.html`: Main UI entry point with localized Tailwind styles and Security Headers.
- `js/app.js`: Core rendering logic (Overview/Daily views) and routing.
- `scripts/fetch_data.js`: Node.js script to fetch CSV from Google Sheet and convert to JSON.
- `data/travel_data.json`: The processed data file used by the frontend.
- `.github/workflows/update_data.yml`: Automation schedule (Daily at 04:00 Taipei time).

## 🛡 Security Standards (Mandatory)
- **Content Security Policy (CSP)**: Strict headers must be maintained in `index.html`. 
- **Privacy Protection**:
  - Never hardcode Google Sheet URLs in the codebase.
  - Use GitHub Secrets (`SHEET_URL`) for data fetching.
  - Sensitive files like `.env` and original CSV templates must be ignored by Git.
- **Hardware Security**: `Permissions-Policy` must disable camera, microphone, and geolocation by default.

## 🎨 UI & UX Design Rules
- **Mobile First**: All components must be optimized for horizontal scrolling on mobile (Overview).
- **Highlights System**: `renderAttractionHighlights` must be used to parse "1. 2. 3." patterns into visual badges.
- **Visual Feedback**:
  - Use the `animate-wiggle` class for "View Details" buttons to guide user interaction.
  - Use consistent color tokens: `emerald` for attractions, `blue` for transport, `amber` for highlights.
- **Centered Desktop View**: Main content container should be centered with `max-w-2xl` on large screens.

## ⚙️ Automation Logic
- **Schedule**: The project updates automatically via GitHub Actions every day at 20:00 UTC (04:00 Taipei).
- **Manual Trigger**: Can be manually updated via GitHub Actions "Run workflow" button.
- **Data Integrity**: If the JSON fetch fails, show a clear error message to the user.

## ⚠️ Collaboration Warnings
- **DO NOT** commit `data/travel_data.json` unless explicitly forced, as it is a build artifact (maintained by the Action).
- **DO NOT** remove `rel="noopener noreferrer"` from external links.
