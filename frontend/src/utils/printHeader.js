import { api } from '../api/client';

/** Shared print document styles - same as used in print windows */
export const PRINT_DOC_STYLES = `
  body { font-family: system-ui, sans-serif; padding: 16px; margin: 0; }
  .print-company-header { }
  h1, h2 { margin: 12px 0 8px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; }
  th { background: #f3f4f6; }
`;

/**
 * Export the same HTML used for print as a PDF file (same design as print).
 * Uses a temporary DOM element in-viewport (but invisible) so html2canvas can capture content.
 * @param {string} fullHtml - Full document HTML (e.g. <html><head><style>...</style></head><body>...</body></html>)
 * @param {string} filename - Download filename (e.g. 'ledger.pdf')
 * @returns {Promise<void>}
 */
export async function exportPrintAsPdf(fullHtml, filename) {
  const html2pdf = (await import('html2pdf.js')).default;

  // Extract body content and styles
  let bodyContent = fullHtml;
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) bodyContent = bodyMatch[1];
  const styleMatch = fullHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styleCss = styleMatch ? styleMatch[1] : '';

  const wrapper = document.createElement('div');
  // In-viewport but invisible: html2canvas cannot capture offscreen (e.g. left:-9999px) content
  wrapper.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'width: 794px',  // A4 width in px at 96dpi
    'min-height: 100px',
    'padding: 16px',
    'font-family: system-ui, sans-serif',
    'background: #fff',
    'color: #000',
    'opacity: 0',
    'pointer-events: none',
    'z-index: -1',
    'overflow: visible',
  ].join(';');
  wrapper.setAttribute('data-pdf-export', '1');

  if (styleCss) {
    const styleEl = document.createElement('style');
    styleEl.textContent = styleCss;
    wrapper.appendChild(styleEl);
  }
  const inner = document.createElement('div');
  inner.innerHTML = bodyContent;
  wrapper.appendChild(inner);

  document.body.appendChild(wrapper);

  try {
    await new Promise((r) => setTimeout(r, 200));
    const w = Math.max(wrapper.scrollWidth || 794, 794);
    const h = Math.max(wrapper.scrollHeight || 1123, 400);
    const opt = {
      margin: 10,
      filename: filename.replace(/\s+/g, '-'),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: w,
        windowHeight: h,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };
    await html2pdf().set(opt).from(wrapper).save();
  } finally {
    if (wrapper.parentNode) document.body.removeChild(wrapper);
  }
}

/**
 * Fetch company settings and logo URL for use in print views.
 * @returns {Promise<{ companyName: string, address: string, phone: string, email: string, website: string, taxNumber: string, logoUrl: string|null }>}
 */
export async function getCompanyForPrint() {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const [settings, logoRes] = await Promise.all([
    api.get('/settings').catch(() => ({})),
    fetch('/api/settings/logo', { headers }).then((r) => (r.ok ? r.blob() : null)).catch(() => null),
  ]);
  let logoUrl = null;
  if (logoRes) logoUrl = URL.createObjectURL(logoRes);
  return {
    companyName: settings.company_name || '',
    address: settings.company_address || '',
    phone: settings.company_phone || '',
    email: settings.company_email || '',
    website: settings.company_website || '',
    taxNumber: settings.company_tax_number || '',
    logoUrl,
  };
}

/**
 * Build HTML string for company header (logo beside company name), for print window.
 * @param {object} company - Company settings (companyName, logoUrl, etc.)
 * @param {string} title - Header title
 * @param {string} [subtitle] - Header subtitle
 * @param {{ forPdf?: boolean }} [opts] - If forPdf is true, omit logo to avoid blob URL issues in PDF export
 */
export function buildPrintHeaderHtml(company, title, subtitle = '', opts = {}) {
  const lines = [];
  if (company.address) lines.push(company.address);
  if (company.phone) lines.push(`Tel: ${company.phone}`);
  if (company.email) lines.push(company.email);
  if (company.website) lines.push(company.website);
  if (company.taxNumber) lines.push(`Tax #: ${company.taxNumber}`);
  const details = lines.join('  |  ');
  const showLogo = company.logoUrl && !opts.forPdf;
  return `
    <div class="print-company-header" style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;">
      ${showLogo ? `<img src="${company.logoUrl}" alt="Logo" style="height:44px;width:auto;object-fit:contain;" />` : ''}
      <div>
        ${company.companyName ? `<div style="font-size:16px;font-weight:700;color:#0f172a;">${company.companyName}</div>` : ''}
        ${details ? `<div style="font-size:9px;color:#64748b;margin-top:4px;">${details}</div>` : ''}
        ${title ? `<div style="font-size:12px;font-weight:700;margin-top:8px;">${title}</div>` : ''}
        ${subtitle ? `<div style="font-size:10px;color:#475569;">${subtitle}</div>` : ''}
      </div>
    </div>
  `;
}
