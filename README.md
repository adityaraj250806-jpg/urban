# 🏙️ UrbanSync: Geospatial Municipal Incident Management with Fraud-Resistant Credit Allocation

[![Bokaro Steel City](https://img.shields.io/badge/Geography-Bokaro%20Steel%20City%2C%20Jharkhand-0ea5e9?style=for-the-badge&logo=google-maps)](https://en.wikipedia.org/wiki/Bokaro_Steel_City)
[![Architecture](https://img.shields.io/badge/Architecture-Event--Driven%20%7C%20GIS-10b981?style=for-the-badge)](https://nodejs.org)
[![Security](https://img.shields.io/badge/Integrity-MD5%20Media%20Deduplication-6366f1?style=for-the-badge)](https://developer.mozilla.org)
[![Node.js](https://img.shields.io/badge/Node.js-v24.x-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)

> **UrbanSync** is an enterprise-grade, event-driven municipal incident orchestration platform engineered for Indian smart cities. Configured for **Bokaro Steel City, Jharkhand**, UrbanSync integrates citizens, frontline sanitation workers (*Field Workers*), zonal municipal officers, and executive city leadership (*Super Admin / CMO*) into an automated, closed-loop incident lifecycle.

---

## 📌 Core Architectural Pillars

1. **Geospatial Bounding & 5-Zone Incident Triage**
   - Precise geospatial polygon bounding box covering Bokaro Steel City (`Lat: 23.6200 - 23.7200 N`, `Lng: 86.0800 - 86.2200 E`, Center: `[23.6693, 86.1511]`).
   - Automated routing of incidents to 5 operational administrative zones:
     - **Zone 1 - North Bokaro**: Sector 1, Sector 2, Bokaro Mall, Ram Mandir, Aerodrome
     - **Zone 2 - South Bokaro**: Sector 11, Sector 12, Camp 2, Balidih Industrial Area, Railway Station
     - **Zone 3 - East Bokaro**: Sector 8, Sector 9, Harla, Noori Masjid, Sector 9 Hospital
     - **Zone 4 - West Bokaro**: Sector 5, Sector 6, Steel Plant Township Gates, Vaishno Devi Temple
     - **Zone 5 - Central Bokaro**: City Centre, Sector 4, Sector 3, City Park, Jagannath Temple, Nehru Zoological Park
   - MongoDB `2dsphere` spatial indexing for fast radial queries and cluster visualization.

2. **Cryptographic Anti-Fraud & Media Fingerprinting**
   - Media integrity engine computing MD5 cryptographic hashes (`photoHash` and `completionPhotoHash`) on incident and completion images to block duplicate or recycled spam submissions.
   - Built-in machine learning classification hooks for automatic waste categorization and person detection.

3. **Event-Driven Real-Time Telemetry (Socket.io)**
   - Bidirectional WebSocket communication pipeline broadcasting incident lifecycle events (`newReport`, `reportUpdated`, `reportResolved`) to administrative dispatch boards with zero page reloads.

4. **Gamified Civic Ledger & Voucher Wallet**
   - Verifiable credit allocation upon supervised incident resolution.
   - Streak counters, engagement badges (*First Report*, *Eco Warrior*, *Green Champion*), and redemption store for UPI payouts, mobile recharges, and municipal utility rebates.

---

## 👥 4-Tier User Role Matrix

| Portal | Interface | Responsibilities |
| :--- | :--- | :--- |
| **Citizen (Resident)** | `/index.html` | Geotagged incident submission, status tracking, Bokaro heatmap, civic wallet, rewards store. |
| **Field Worker** | `/worker-login.html`<br>`/worker-register.html` | Aadhaar KYC registration, task acceptance in assigned Bokaro sector, before/after cleanup photo verification. |
| **Zone Municipal Officer** | `/officer-login.html`<br>`/officer-dashboard.html` | Scoped ward dispatching, worker assignment, cleanup proof audit, ticket resolution. |
| **Super Admin (*CMO*)** | `/super-admin-login.html`<br>`/super-admin-dashboard.html` | Executive municipal command center, officer provisioning, worker approval queue, citywide KPI analytics. |

---

## 💻 Tech Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES6+), Modern CSS3 (Glassmorphism & Responsive Grids), Leaflet.js GIS, Leaflet Heatmap & MarkerCluster.
- **Backend**: Node.js (v24), Express.js (v4), Socket.io (v4 WebSockets).
- **Database**: MongoDB Atlas with Mongoose ODM (Geospatial `2dsphere` indexes, connect-mongo session persistence).
- **Authentication**: JWT (JSON Web Tokens), bcryptjs salted password hashing, Express Sessions, Role-Based Access Control (RBAC).
- **Media Pipeline**: Multer multipart upload with Cloudinary CDN fallback and local disk streaming.

---

## 🛠️ Local Development & Setup

### 1. Prerequisites
- Node.js (v18.x or v24.x recommended)
- A dedicated MongoDB instance (Local MongoDB or a fresh MongoDB Atlas cluster)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/adityaraj250806-jpg/urbansync.git
cd urbansync

# Install dependencies
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root based on `.env.example`:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/urbansync?retryWrites=true&w=majority
JWT_SECRET=urbansync_jwt_secure_secret_bokaro_2026
SESSION_SECRET=urbansync_session_secure_secret_bokaro_2026
NODE_ENV=development
CLOUDINARY_FOLDER=urbansync
```

### 4. Running the Application
```bash
# Start in development mode with nodemon
npm run dev

# Or start standard production server
npm start
```
Access the application at `http://localhost:3000`.

### 5. Seeding Demonstration Accounts & Incidents
Visit the following endpoints while running locally:
- Seed Bokaro municipal accounts: `http://localhost:3000/api/admin/create-demo-accounts`
- Seed Bokaro 5-zone incident markers: `http://localhost:3000/api/admin/create-demo-reports`

---

## 🔒 Security & Data Isolation
- **Separate Environment**: UrbanSync operates on completely independent database clusters and storage namespaces isolated from legacy prototypes.
- **Credential Hygiene**: Production credentials and secrets are excluded via `.gitignore`.

---

## 📄 License & Attribution
**Copyright (c) 2026 Aditya Raj.** All Rights Reserved.  
Developed as an academic and technological innovation in Geospatial Municipal Incident Management for Bokaro Steel City, Jharkhand, India.
