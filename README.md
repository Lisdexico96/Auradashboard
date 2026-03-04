# AURA Dashboard

Performance & accounts dashboard built with **Next.js**, **React**, **Tailwind CSS**, and **shadcn-style** components.

## Stack

- **Next.js 14** (App Router)
- **React 18**
- **Tailwind CSS** (dark theme, custom CSS variables)
- **shadcn-style UI** (Button, Card, Input, Label, DropdownMenu) with `class-variance-authority`, `clsx`, `tailwind-merge`
- **xlsx** for Excel import/export
- **jspdf** for PDF export

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Add your AURA logo for the background:
   - Place `aura-logo.png` in **`public/assets/`** so the semi-3D background image loads at `/assets/aura-logo.png`.

3. Run the dev server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Features

- **Data & settings**: Upload CSV/Excel, set month/year, date range (From–To), manual totals when not using raw data.
- **Overview KPIs**: Total Sales, Messages, Subscriptions, This month vs last %, Forecast, Agency Growth.
- **Filters**: Model and Partner with searchable dropdowns.
- **Download view**: CSV, Excel, or PDF of the current filtered table.
- **Sortable table**: Click column headers to sort.
- **Persistence**: Settings and data are saved in `localStorage`.

## Project structure

- `src/app/` – Next.js App Router (layout, page, globals.css)
- `src/components/ui/` – Button, Card, Input, Label, DropdownMenu
- `src/components/dashboard/` – `DashboardClient.tsx` (main client dashboard)
- `src/lib/` – `utils.ts` (cn), `dashboard-data.ts` (parsing, aggregation, buildViewRows)
- `public/` – Static assets; put `assets/aura-logo.png` here for the logo background.
- `dashboard_template.csv` is served from `public/dashboard_template.csv`.

## Build

```bash
npm run build
npm start
```

The original vanilla HTML/CSS/JS version is still in the repo root (`index.html`, `script.js`, `styles.css`) if you need it.
