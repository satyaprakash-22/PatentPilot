import express from 'express';
import cors from 'cors';
import analysesRouter from './routes/analyses';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/analyses', analysesRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PatentPilot API' });
});

// Start server
app.listen(PORT, () => {
  console.log(`[PatentPilot] Server running on http://localhost:${PORT}`);
});

export default app;
