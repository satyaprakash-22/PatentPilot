# PatentPilot

AI-assisted Freedom-to-Operate (FTO) workspace built for the Centella AI Therapeutics Product Engineering Assessment.

PatentPilot helps researchers check whether a molecule they're working on might already be covered by existing patents using a hybrid retrieval system (structural matching via PubChem + keyword search via Google Patents) and grounded Gemini LLM analysis.

## Requirements

- Node.js (v18 or newer recommended)
- PostgreSQL (local or cloud-hosted)
- Google Gemini API Key

## Setup Instructions

### 1. Database and Environment

1. Clone the repository
2. Create a copy of `.env.example` in the `server` directory and name it `.env`
   ```bash
   cd server
   cp ../.env.example .env
   ```
3. Update `.env` with your PostgreSQL database URL and Gemini API key.

### 2. Backend Setup

```bash
cd server
npm install
npm run db:push
npm run dev
```

The API will start on `http://localhost:3001`.

### 3. Frontend Setup

In a new terminal window:

```bash
cd client
npm install
npm run dev
```

The web app will be available at `http://localhost:5173`.
