import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, Package, ShoppingCart, Search, X } from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [productModal, setProductModal] = useState(null);
  const [saleModal, setSaleModal] = useState(null);
  const [saleEditModal, setSaleEditModal] = useState(null);
  const [filters, setFilters] = useState({ product_id: '', branch_id: '', from: '', to: '' });
  const [productSearch, setProductSearch] = useState('');
  const [productForm, setProductForm] = useState({ name: '', unit_price: 0 });
  const [saleForm, setSaleForm] = useState({ product_id: '', branch_id: '', sale_date: '', quantity: '', unit_price: '' });
  const [saleEditForm, setSaleEditForm] = useState({ id: null, sale_date: '', quantity: '', unit_price: '' });
  const [saleProductSearch, setSaleProductSearch] = useState('');
  const [saleProductDropdownOpen, setSaleProductDropdownOpen] = useState(false);
  const saleProductDropdownRef = useRef(null);

  const loadProducts = () => api.get('/inventory/products').then(setProducts).catch((e) => setErr(e.message));
  const loadSales = () => {
    const q = new URLSearchParams();
    if (filters.product_id) q.set('product_id', filters.product_id);
    if (filters.branch_id) q.set('branch_id', filters.branch_id);
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    api.get(`/inventory/sales?${q}`).then(setSales).catch((e) => setErr(e.message));
  };

  useEffect(() => { loadProducts(); loadSales(); api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);
  useEffect(() => { loadSales(); }, [filters.product_id, filters.branch_id, filters.from, filters.to]);
  useEffect(() => { setLoading(false); }, [products, sales]);

  useEffect(() => {
    if (!saleProductDropdownOpen) return;
    const onDocClick = (e) => {
      if (saleProductDropdownRef.current && !saleProductDropdownRef.current.contains(e.target)) setSaleProductDropdownOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [saleProductDropdownOpen]);

  const openProductAdd = () => {
    setProductForm({ name: '', unit_price: 0 });
    setProductModal('add');
  };

  const openProductEdit = (p) => {
    setProductForm({ id: p.id, name: p.name, unit_price: p.unit_price ?? 0 });
    setProductModal('edit');
  };

  const openSaleAdd = () => {
    setSaleForm({ product_id: '', branch_id: branches[0]?.id || '', sale_date: new Date().toISOString().slice(0, 10), quantity: '', unit_price: '' });
    setSaleProductSearch('');
    setSaleProductDropdownOpen(false);
    setSaleModal(true);
  };

  const saleProductSearchLower = (saleProductSearch || '').trim().toLowerCase();
  const saleProductOptions = saleProductSearchLower
    ? products.filter((p) => (p.name || '').toLowerCase().includes(saleProductSearchLower))
    : products;

  const selectSaleProduct = (p) => {
    setSaleForm((f) => ({ ...f, product_id: String(p.id), unit_price: p.unit_price ?? '' }));
    setSaleProductSearch(p.name);
    setSaleProductDropdownOpen(false);
  };

  const clearSaleProduct = () => {
    setSaleForm((f) => ({ ...f, product_id: '' }));
    setSaleProductSearch('');
    setSaleProductDropdownOpen(true);
  };

  const openSaleEdit = (s) => {
    setSaleEditForm({ id: s.id, sale_date: s.sale_date, quantity: s.quantity, unit_price: s.unit_price ?? '' });
    setSaleEditModal(s);
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (productModal === 'add') await api.post('/inventory/products', productForm);
      else await api.patch(`/inventory/products/${productForm.id}`, productForm);
      setProductModal(null);
      loadProducts();
    } catch (e) {
      setErr(e.message);
    }
  };

  const saveSale = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const payload = {
        ...saleForm,
        branch_id: saleForm.branch_id || null,
        unit_price: saleForm.unit_price === '' ? undefined : saleForm.unit_price,
      };
      await api.post('/inventory/sales', payload);
      setSaleModal(null);
      setSaleProductSearch('');
      setSaleProductDropdownOpen(false);
      loadSales();
    } catch (e) {
      setErr(e.message);
    }
  };

  const saveSaleEdit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.patch(`/inventory/sales/${saleEditForm.id}`, {
        sale_date: saleEditForm.sale_date,
        quantity: saleEditForm.quantity,
        unit_price: saleEditForm.unit_price || undefined,
      });
      setSaleEditModal(null);
      loadSales();
    } catch (e) {
      setErr(e.message);
    }
  };

  const deleteProduct = async (id) => {
    if (!confirm('Delete this product?')) return;
    try {
      await api.delete(`/inventory/products/${id}`);
      loadProducts();
    } catch (e) {
      setErr(e.message);
    }
  };

  const deleteSale = async (id) => {
    if (!confirm('Delete this sale?')) return;
    try {
      await api.delete(`/inventory/sales/${id}`);
      loadSales();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const productSearchLower = (productSearch || '').trim().toLowerCase();
  const filteredProducts = productSearchLower
    ? products.filter((p) => (p.name || '').toLowerCase().includes(productSearchLower))
    : products;

  const selectedProduct = products.find((p) => String(p.id) === String(saleForm.product_id));
  const effectiveUnitPrice = saleForm.unit_price !== ''
    ? Number(saleForm.unit_price)
    : Number(selectedProduct?.unit_price || 0);
  const saleTotal = (Number(saleForm.quantity) || 0) * (effectiveUnitPrice || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 mt-1">Add product details · Enter date when sold · Add sold quantity</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openProductAdd} className="btn-secondary"><Package className="w-4 h-4" /> Add Product Details</button>
          <button onClick={openSaleAdd} className="btn-primary" disabled={!products.length} title={!products.length ? 'Add at least one product first' : ''}><ShoppingCart className="w-4 h-4" /> Add Sale</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <h3 className="font-semibold text-slate-900 mb-3">Inventory Sales — Date when sold · Sold quantity</h3>
        <div className="flex flex-wrap gap-4 mb-4">
          <select className="input w-40" value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input w-40" value={filters.branch_id} onChange={(e) => setFilters({ ...filters, branch_id: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className="input w-40" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" className="input w-40" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Date when sold</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Product</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Sold quantity</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Total</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sales.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{s.sale_date}</td>
                  <td className="px-4 py-3 font-medium">{s.product_name}</td>
                  <td className="px-4 py-3">{s.branch_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.unit_price)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openSaleEdit(s)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteSale(s.id)} className="p-1.5 text-slate-500 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sales.length && !loading && <p className="p-6 text-center text-slate-500">No sales yet. Add a sale with date when sold and sold quantity.</p>}
      </div>

      <div className="card p-4">
        <h3 className="font-semibold text-slate-900 mb-3">Inventory Details</h3>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className="input pl-9"
              placeholder="Search by name..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
          </div>
          {productSearch && (
            <span className="text-sm text-slate-500">
              {filteredProducts.length} of {products.length} product{products.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredProducts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(p.unit_price)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openProductEdit(p)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteProduct(p.id)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!products.length && !loading && <p className="p-6 text-center text-slate-500">No product details yet. Add product details to get started.</p>}
        {products.length && !filteredProducts.length && <p className="p-6 text-center text-slate-500">No products match &quot;{productSearch}&quot;.</p>}
      </div>

      {productModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{productModal === 'add' ? 'Add Product Details' : 'Edit Product Details'}</h2>
            <form onSubmit={saveProduct} className="space-y-4">
              <div><label className="label">Product name *</label><input className="input" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="e.g. Widget A" required /></div>
              <div><label className="label">Unit price</label><input type="number" step="0.01" min="0" className="input" value={productForm.unit_price} onChange={(e) => setProductForm({ ...productForm, unit_price: e.target.value })} placeholder="0" /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setProductModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {saleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Sale</h2>
            <p className="text-sm text-slate-500 mb-4">Search a product, select from the dropdown, then enter date and quantity.</p>
            <form onSubmit={saveSale} className="space-y-4">
              <div ref={saleProductDropdownRef} className="relative">
                <label className="label">Product *</label>
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      className="input pl-9 pr-9"
                      placeholder={saleForm.product_id ? '' : 'Search product by name...'}
                      value={saleProductSearch}
                      onChange={(e) => {
                        setSaleProductSearch(e.target.value);
                        setSaleForm((f) => ({ ...f, product_id: '' }));
                        setSaleProductDropdownOpen(true);
                      }}
                      onFocus={() => setSaleProductDropdownOpen(true)}
                      autoComplete="off"
                    />
                    {saleForm.product_id && (
                      <button type="button" onClick={clearSaleProduct} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 text-slate-500" title="Clear"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
                {saleProductDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg z-50 max-h-48 overflow-y-auto">
                    {saleProductOptions.length ? (
                      saleProductOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectSaleProduct(p); }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex justify-between items-center ${saleForm.product_id === String(p.id) ? 'bg-primary-50 text-primary-700' : ''}`}
                        >
                          <span>{p.name}</span>
                          <span className="text-slate-400 font-mono text-xs">{p.unit_price != null ? Number(p.unit_price).toLocaleString() : ''}</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-4 py-3 text-sm text-slate-500">No products match. Add product details first.</p>
                    )}
                  </div>
                )}
              </div>
              <div><label className="label">Date when sold *</label><input type="date" className="input" value={saleForm.sale_date} onChange={(e) => setSaleForm({ ...saleForm, sale_date: e.target.value })} required /></div>
              <div><label className="label">Sold quantity *</label><input type="number" min="1" className="input" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} placeholder="e.g. 10" required /></div>
              <div><label className="label">Branch</label><select className="input" value={saleForm.branch_id} onChange={(e) => setSaleForm({ ...saleForm, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="label">Unit price <span className="text-slate-400 font-normal">(optional, uses product default)</span></label><input type="number" step="0.01" min="0" className="input" value={saleForm.unit_price} onChange={(e) => setSaleForm({ ...saleForm, unit_price: e.target.value })} placeholder="Override if needed" /></div>
              <p className="text-sm font-medium text-slate-700">Total: {fmt(saleTotal)}</p>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary" disabled={!saleForm.product_id}>Save</button><button type="button" onClick={() => { setSaleModal(false); setSaleProductSearch(''); setSaleProductDropdownOpen(false); }} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {saleEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Edit Sale</h2>
            <p className="text-sm text-slate-500 mb-4">Product: {saleEditModal.product_name}</p>
            <form onSubmit={saveSaleEdit} className="space-y-4">
              <div><label className="label">Date when sold *</label><input type="date" className="input" value={saleEditForm.sale_date} onChange={(e) => setSaleEditForm({ ...saleEditForm, sale_date: e.target.value })} required /></div>
              <div><label className="label">Sold quantity *</label><input type="number" min="1" className="input" value={saleEditForm.quantity} onChange={(e) => setSaleEditForm({ ...saleEditForm, quantity: e.target.value })} required /></div>
              <div><label className="label">Unit price</label><input type="number" step="0.01" min="0" className="input" value={saleEditForm.unit_price} onChange={(e) => setSaleEditForm({ ...saleEditForm, unit_price: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Update</button><button type="button" onClick={() => setSaleEditModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
