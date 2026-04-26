# Kollel Tracker - GEMINI.md

## Project Overview
Kollel Tracker is a specialized time-tracking web application designed for Kollel members to log their study sessions. It utilizes a **Google Apps Script** backend and a modern, responsive **Single Page Application (SPA)** frontend.

### Main Technologies
- **Backend:** Google Apps Script (`code.gs`)
- **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS (via CDN), Lucide Icons
- **Database:** Google Sheets (Backend storage)
- **Communication:** JSONP (to facilitate cross-origin requests from the frontend to the Google Apps Script Web App)

### Architecture
- **Server-Side (`code.gs`):** Handles authentication, session management (start/end), data persistence in Google Sheets, and report generation. It uses `LockService` to ensure data integrity during concurrent writes.
- **Client-Side (`index.html`):** A mobile-first UI that manages the timer, user state, and communication with the Google Script URL. It uses `localStorage` for session persistence.
- **Data Model:**
  - `users` sheet: Stores user credentials (ID, Name, Password, Admin status, Active status).
  - Monthly sheets (e.g., `2026-04`): Stores individual session records (UUID, User ID, Date, Start/End times, Duration).

## User Management (Admin Only)
Administrators can manage the user roster via the "User Management" tab in the Admin Console.
- **Add/Edit Users:** Admins can create new accounts or modify names and passwords.
- **Soft Deletion:** Users are never fully deleted; they are marked as "Inactive" to preserve historical data. Inactive users cannot log in or start sessions.
- **Safety Constraints:** 
    - The first user in the system (ID 1) is the primary administrator and cannot be deactivated or downgraded.
    - An admin cannot deactivate their own account.

## Building and Running
As a Google Apps Script project, it does not have a traditional local build process.

### Deployment
1. **Google Spreadsheet:** Create a spreadsheet and add a sheet named `users` with headers: `id`, `user_name`, `password`, `is_admin`.
2. **Apps Script:**
   - Create a new project at [script.google.com](https://script.google.com).
   - Copy the content of `code.gs` into the script editor.
   - Deploy as a **Web App**:
     - **Execute as:** Me
     - **Who has access:** Anyone
3. **Frontend:**
   - The `index.html` file contains a hardcoded `GOOGLE_SCRIPT_URL`. Update this with the URL from your Web App deployment.
   - The frontend can be hosted on any static web host or served via `HtmlService` if integrated directly into the Apps Script project.

### Development
- **TODO:** Integrate [clasp](https://github.com/google/clasp) for local development and version control synchronization.

## Development Conventions
- **UI/UX:** Adheres to a "glassmorphism" aesthetic with high-contrast typography (Plus Jakarta Sans). Tailwind CSS utility classes are used for all styling.
- **Error Handling:** Backend returns JSON/JSONP objects with a `success` boolean and optional `message`/`error` fields.
- **Concurrency:** Always use `LockService` in `code.gs` when writing to sheets to prevent data loss.
- **Timezones:** Defaults to `America/Chicago` (configurable in `CONFIG` within `code.gs`).
- **Naming:** CamelCase for JavaScript functions and variables; SCREAMING_SNAKE_CASE for backend configuration constants.
