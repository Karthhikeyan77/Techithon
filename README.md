# TECH AUCTION — TECHITHON

**THINK. BID. CONQUER.**

A real-time, team-based technology auction competition platform built for **TECHITHON – THE ULTIMATE TECH CHALLENGE**.

## Architecture Overview

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide React, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO, Zod validation, Rate limiting
- **Database & Auth**:
  - Persistent SQLite (`node:sqlite` in WAL mode) for ACID transactional bidding, per-room serialized locking, server-authoritative timers, and instant server-restart recovery.
  - Firebase Authentication (Google Sign-In) for Host identity verification and Firebase Firestore synchronization with hardened `firestore.rules`.

## Three Role-Isolated Interfaces

1. **Host / Admin Dashboard (`/host`)**:
   - 9-section control center: *Dashboard*, *Create Room (6-step wizard)*, *My Rooms*, *Live Auction*, *Teams*, *Question & Item Bank (CSV import/export)*, *Leaderboard*, *Auction History & Final Results (CSV export)*, and *Settings*.
2. **Team Mobile Interface (`/team`)**:
   - Mobile-first thumb-zone bidding screen. Teams join via Room Code + Team Name + optional PIN. Displays live balance, points, current object, synchronized countdown, quick-bid chips, winning question, and live leaderboard.
3. **Audience / Projector Display (`/audience`)**:
   - Full-screen auditorium display showing TECHITHON branding, active object, highest bid, leading team, large synchronized countdown, winning announcements, revealed questions (never exposing answer keys before scoring), and live rankings.

## Demo Mode

A pre-seeded **Sample Demo Room (`TECH26`)** includes 15 first-year engineering items (Raspberry Pi, Arduino Uno, CPU, GPU, IoT, Smartphone, Keyboard & Mouse, Pen Drive, Wi-Fi Router, Bluetooth, RAM, SSD, QR Code, Machine Learning, Cloud Computing) and 3 sample teams. Demo data is isolated from custom rooms and can be reset anytime from **Settings**.

## How to Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the full-stack server (port `3000`):
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser.

## Database & Firebase Configuration

- SQLite database file is created automatically at `.data/tech_auction.db` on startup (no manual SQL setup required).
- Firebase project configuration is stored in `firebase-applet-config.json`, and security rules are defined in `firestore.rules` and `firebase-blueprint.json`.

## How to Create a Host Account & Room

1. Click **Host Control Center** on the landing page and sign in with your Google account.
2. Open **Create Room** in the sidebar.
3. Follow the 6-step wizard: Room Details -> Coin Settings -> Auction Settings -> Question Settings -> Add Auction Items (`+ ADD NEW ITEM` or pick from Question Bank) -> Review & Create.
4. Share the generated Room Code (and optional PIN) with participating teams.

## How Teams Join

1. Teams open the app URL on their smartphones and select **Enter as Team** (or `/team`).
2. Enter the **Room Code**, unique **Team Name**, and optional **PIN**.
3. Teams immediately receive the configured starting coins and enter the live bidding interface.

## How to Build & Deploy

```bash
npm run build
npm start
```

## How to Run Automated Functional & 60-Client Concurrency Tests

```bash
npm test
```

This runs functional tests (custom room creation, PIN/duplicate-team validation, answer-key isolation, bid rules, idempotency, exact-once scoring, CSV export, server restart recovery) and a **60-client Socket.IO concurrency load test** verifying convergence, timer expiration, reconnection, and cross-room isolation.
