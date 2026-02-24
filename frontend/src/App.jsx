import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Branches from './pages/Branches';
import Sales from './pages/Sales';
import Receivables from './pages/Receivables';
import Purchases from './pages/Purchases';
import Suppliers from './pages/Suppliers';
import Banks from './pages/Banks';
import PL from './pages/PL';
import Staff from './pages/Staff';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Settings from './pages/Settings';
import RentBills from './pages/RentBills';
import Payments from './pages/Payments';
import Customers from './pages/Customers';
import CustomerLedgerWindow from './pages/CustomerLedgerWindow';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/ledger/:customerId" element={<CustomerLedgerWindow />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="branches" element={<Branches />} />
        <Route path="sales" element={<Sales />} />
        <Route path="receivables" element={<Receivables />} />
        <Route path="customers" element={<Customers />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="banks" element={<Banks />} />
        <Route path="pl" element={<PL />} />
        <Route path="staff" element={<Staff />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="reports" element={<Reports />} />
        <Route path="rent-bills" element={<RentBills />} />
        <Route path="payments" element={<Payments />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
