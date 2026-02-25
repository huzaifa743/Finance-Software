import { api } from '../api/client';

/**
 * Shared print document styles — professional, modern layout for all modules.
 * Used in print windows and PDF export. Logo + company name on first line;
 * address, phone, email, website, tax on second line; report title below.
 */
export const PRINT_DOC_STYLES = `
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .print-break-before { page-break-before: always; }
    .print-break-after { page-break-after: always; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    thead { display: table-header-group; }
  }

  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    color: #1e293b;
    margin: 0;
    padding: 20px 24px;
    max-width: 210mm;
  }

  .print-company-header {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 2px solid #e2e8f0;
  }
  .print-company-header .logo-wrap {
    flex-shrink: 0;
  }
  .print-company-header .logo-wrap img {
    height: 48px;
    width: auto;
    max-width: 140px;
    object-fit: contain;
    display: block;
  }
  .print-company-header .brand-wrap {
    flex: 1;
    min-width: 0;
  }
  .print-company-header .company-name {
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.02em;
    margin: 0 0 6px 0;
  }
  .print-company-header .company-details {
    font-size: 9px;
    color: #64748b;
    margin: 0 0 10px 0;
    line-height: 1.5;
  }
  .print-company-header .report-title {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 2px 0;
  }
  .print-company-header .report-subtitle {
    font-size: 10px;
    color: #475569;
    margin: 0;
  }

  .print-body { margin-top: 4px; }
  .print-body p { margin: 0 0 8px 0; }
  .print-body .summary-line {
    font-size: 11px;
    color: #475569;
    margin-bottom: 12px;
  }
  .print-body .summary-line strong { color: #0f172a; }

  h1, h2, h3 {
    font-weight: 600;
    color: #0f172a;
    margin: 18px 0 8px 0;
    font-size: 12px;
  }
  h1 { font-size: 14px; margin-top: 0; }
  h2 { font-size: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }

  table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 8px;
    margin-bottom: 16px;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    text-align: left;
  }
  th {
    background: #f1f5f9;
    font-weight: 600;
    color: #334155;
    font-size: 10px;
  }
  tr:nth-child(even) { background: #f8fafc; }
  @media print {
    tr:nth-child(even) { background: #f8fafc !important; }
  }
  .text-right { text-align: right; }
  .text-left { text-align: left; }
  .font-mono { font-variant-numeric: tabular-nums; }

  .print-footer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px;
    color: #94a3b8;
  }
`;

/**
 * Export the same HTML used for print as a PDF file (same design as print).
 */
export async function exportPrintAsPdf(fullHtml, filename) {
  const html2pdf = (await import('html2pdf.js')).default;

  let bodyContent = fullHtml;
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) bodyContent = bodyMatch[1];
  const styleMatch = fullHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styleCss = styleMatch ? styleMatch[1] : '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'width: 794px',
    'min-height: 100px',
    'padding: 20px 24px',
    'font-family: "Segoe UI", system-ui, sans-serif',
    'background: #fff',
    'color: #1e293b',
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
 * Build HTML for company header: logo (if present) and company name on first line;
 * address, phone, email, website, tax on the line below; report title and subtitle under that.
 * @param {object} company - Company settings (companyName, logoUrl, address, etc.)
 * @param {string} title - Report title
 * @param {string} [subtitle] - Report subtitle (e.g. Customer name, date range)
 * @param {{ forPdf?: boolean }} [opts] - forPdf: true omits logo to avoid blob URL issues in PDF export
 */
export function buildPrintHeaderHtml(company, title, subtitle = '', opts = {}) {
  const parts = [];
  if (company.address) parts.push(company.address);
  if (company.phone) parts.push(`Tel: ${company.phone}`);
  if (company.email) parts.push(company.email);
  if (company.website) parts.push(company.website);
  if (company.taxNumber) parts.push(`Tax #: ${company.taxNumber}`);
  const detailsLine = parts.join('  ·  ');
  const showLogo = company.logoUrl && !opts.forPdf;

  return `
    <div class="print-company-header">
      ${showLogo ? `<div class="logo-wrap"><img src="${company.logoUrl}" alt="Logo" /></div>` : ''}
      <div class="brand-wrap">
        ${company.companyName ? `<div class="company-name">${company.companyName}</div>` : ''}
        ${detailsLine ? `<div class="company-details">${detailsLine}</div>` : ''}
        ${title ? `<div class="report-title">${title}</div>` : ''}
        ${subtitle ? `<div class="report-subtitle">${subtitle}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Wrap body HTML in a full document with shared print styles and optional title.
 * Use this so every module uses the same design.
 */
export function buildPrintDocumentHtml(headerHtml, bodyHtml, title = 'Print') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${PRINT_DOC_STYLES}</style>
</head>
<body>
  ${headerHtml}
  <div class="print-body">${bodyHtml}</div>
</body>
</html>`;
}
