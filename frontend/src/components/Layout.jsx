import { useState } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Building2,
  ShoppingCart,
  Receipt,
  Truck,
  Landmark,
  TrendingUp,
  Users,
  UserCircle,
  Boxes,
  BarChart3,
  Settings,
  Shield,
  LogOut,
  Menu,
  X,
  ChevronDown,
  CreditCard,
  FileText,
} from 'lucide-react';

// Sidebar: Overview → Setup → Income → Expenses → Payments → Operations → Reports → Admin
const nav = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/branches', label: 'Branches', icon: Building2 },
  { path: '/banks', label: 'Banks', icon: Landmark },
  { path: '/suppliers', label: 'Suppliers', icon: Users },
  { path: '/inventory', label: 'Inventory', icon: Boxes },
  { path: '/sales', label: 'Sales', icon: ShoppingCart },
  { path: '/receivables', label: 'Receivables', icon: Receipt },
  { path: '/purchases', label: 'Purchases', icon: Truck },
  { path: '/rent-bills', label: 'Rent & Bills', icon: FileText },
  { path: '/payments', label: 'Payments', icon: CreditCard },
  { path: '/staff', label: 'Staff & Salary', icon: Users },
  { path: '/pl', label: 'Profit & Loss', icon: TrendingUp },
  { path: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { path: '/users', label: 'Users & Roles', icon: Shield },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col w-72 bg-slate-900 text-white transform transition-all duration-300 ease-out shadow-xl ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between h-14 px-5 border-b border-white/5">
          <Link to="/" className="font-semibold text-[15px] tracking-tight text-primary-400">Finance Software</Link>
          <button onClick={() => setSidebarOpen(false)} className="p-2 -m-2 rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 flex flex-col min-h-0 py-4 px-3">
          <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
            {nav.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 py-2.5 pr-3 rounded-xl text-sm font-medium transition-all duration-200 shrink-0 border-l-2 ${
                  location.pathname === path
                    ? 'bg-primary-500/15 text-white border-primary-500 pl-[14px] -ml-px'
                    : 'border-transparent pl-4 text-white/80 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${location.pathname === path ? 'text-white' : 'text-white/70'}`} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2"
            aria-label="Open navigation menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setUserMenu(!userMenu)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-100"
            >
              <span className="text-sm font-medium text-slate-700">{user?.name}</span>
              <span className="text-xs text-slate-500">({user?.role_name})</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {userMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                <div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg z-20">
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
