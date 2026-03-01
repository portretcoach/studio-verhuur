# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Studio Verhuur is a Dutch-language studio rental dashboard and photoshoot booking system. Fully client-side (vanilla JS, no framework, no build step). Hosted on GitHub Pages at `portretcoach.github.io/studio-verhuur`.

## Architecture

### Three pages, three subsystems

| Page | Files | Purpose |
|------|-------|---------|
| **Dashboard** | `index.html`, `app.js`, `style.css` | Admin/tenant portal: calendar, strippenkaarten, contracts, huurder management |
| **Fotoshoot booking** | `fotoshoot.html`, `fotoshoot.js`, `fotoshoot.css` | Public booking wizard with confirmation emails |
| **Fotoshoot admin** | `fotoshoot-admin.html`, `fotoshoot-admin.js`, `fotoshoot.css` | PIN-protected (default: 1234) slot management |

### Data storage

All data lives in **localStorage** — there is no backend. Keys are prefixed `sv_`:

- `sv_users` — user accounts (admin + huurders)
- `sv_availability` — calendar date → status map
- `sv_bookings` — tenant studio bookings
- `sv_strippenkaarten` — punch cards (5 or 10 strips)
- `sv_vaste_huur` — fixed monthly rentals
- `sv_session` — current logged-in user
- `sv_fotoshoot_slots` — date → {times[], startTime, endTime}
- `sv_fotoshoot_bookings` — public fotoshoot bookings
- `sv_fotoshoot_pin` — admin PIN for fotoshoot panel

Helper functions: `load(key)`, `loadMap(key)`, `loadObj(key)`, `save(key, data)`.

### External integrations

- **Google Calendar Sync** — `app.js` fetches studio events on startup via Apps Script, marks dates unavailable
- **EmailJS** — `fotoshoot.js` sends booking confirmation and reschedule emails client-side
- **Google Apps Script + Sheets** — `fotoshoot-reminder.gs` receives booking data via POST, stores in Google Sheet, sends 48h reminder emails via daily trigger

### Key credentials (in fotoshoot.js)

- EmailJS Public Key, Service ID, Template IDs
- Google Apps Script Web App URL for reminders
- Google Sheet ID in `fotoshoot-reminder.gs`

## Business Logic

- **Fotoshoot slots**: 2h session + 30min buffer = 150min between slot starts
- **Booking codes**: format `FS-XXXX` (excludes I/O/0/1 for readability)
- **Strippenkaarten**: 5 strips (valid 3mo) or 10 strips (valid 5mo); 1 strip = 1 day
- **Cancellation rule**: free if ≥7 days before; strip lost if <7 days
- **Fixed occupancy**: Thursdays (until May 2026), Fridays (until April 2026) auto-blocked
- **Roles**: `admin` (manages everything) and `huurder` (books via strippenkaart)
- **Default admin**: username `admin`, password `admin123`

## Design System

CSS custom properties in both stylesheets:
- `--primary: #34535b` (teal)
- `--accent: #dbb458` (gold)
- `--bg: #f5f0ea` (warm beige)

All UI text is in Dutch.

## Deployment

No build step. Push to `main` → GitHub Pages auto-deploys. Repository: `github.com/portretcoach/studio-verhuur`.
