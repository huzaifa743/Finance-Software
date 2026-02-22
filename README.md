# Finance Software

Online finance management application with branch management, sales, receivables, purchases, banks, P&L, staff, inventory, reports, users & security, and system settings.

## Tech Stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3), JWT auth, bcrypt
- **Frontend:** React, Vite, Tailwind CSS, React Router, Recharts

## Setup

### 1. Backend

```bash
cd backend
npm install
npm run init-db
npm run dev
```

API runs at `http://localhost:5000`. Database: `backend/data/finance.db`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`. API requests are proxied to the backend.

### 3. Login

- **Email:** `admin@finance.com`
- **Password:** `admin123`

## Modules & Features

| Module | Features |
|--------|----------|
| **Branch Management** | Add/edit/delete branches, code, location, manager, opening/closing dates, active/inactive, performance summary |
| **Sales** | Manual daily sales (branch-wise), cash/bank/credit, discount & returns, net sales, edit/lock, remarks |
| **Receivables** | Customer ledger, credit sales, partial/full recovery, due balance, overdue alerts |
| **Purchases & Suppliers** | Supplier registration, invoices, branch-wise purchases, partial/full payments, ledger, reminders |
| **Banks** | Multiple accounts, deposits, payments, transfers, ledger, reconciliation |
| **Profit & Loss** | Branch-wise & consolidated P&L, gross profit, monthly/yearly |
| **Staff & Salary** | Branch-wise staff, fixed salary, commission, advances, deductions, salary processing |
| **Inventory** | Products, sale date, quantity sold |
| **Reports & Dashboard** | Daily/monthly/date-range, branch-wise & consolidated, exports (JSON/CSV) |
| **Users & Roles** | Super Admin, Finance Manager, Branch Manager, Data Entry, Auditor; login history, activity logs |
| **Settings** | Financial year, currency, tax, invoice/voucher prefixes |

## Project Structure

```
Finance Software/
├── backend/
│   ├── src/
│   │   ├── db/         # SQLite init & connection
│   │   ├── middleware/ # Auth, activity log
│   │   ├── routes/     # API routes per module
│   │   └── index.js
│   ├── data/           # finance.db (created on init)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/        # API client
│   │   ├── components/ # Layout, sidebar
│   │   ├── context/    # Auth
│   │   ├── pages/      # Module pages
│   │   └── main.jsx
│   └── package.json
└── README.md
```

## License

MIT
