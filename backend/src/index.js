import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import branchesRoutes from './routes/branches.js';
import salesRoutes from './routes/sales.js';
import receivablesRoutes from './routes/receivables.js';
import purchasesRoutes from './routes/purchases.js';
import banksRoutes from './routes/banks.js';
import plRoutes from './routes/pl.js';
import staffRoutes from './routes/staff.js';
import inventoryRoutes from './routes/inventory.js';
import settingsRoutes from './routes/settings.js';
import dashboardRoutes from './routes/dashboard.js';
import rentBillsRoutes from './routes/rentBills.js';
import paymentsRoutes from './routes/payments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const corsOrigin = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? true : 'http://localhost:5173');

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/receivables', receivablesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/banks', banksRoutes);
app.use('/api/pl', plRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/rent-bills', rentBillsRoutes);
app.use('/api/payments', paymentsRoutes);

const clientDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Finance Software API running at http://localhost:${PORT}`);
});

