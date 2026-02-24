import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const brandingDir = path.join(__dirname, '../../data/branding');

const COMPANY_KEYS = [
  'company_name',
  'company_phone',
  'company_address',
  'company_email',
  'company_website',
  'company_tax_number',
];

/**
 * Get company settings from database and filesystem (logo).
 * @param {object} db - better-sqlite3 database instance
 * @returns {{ companyName, phone, address, email, website, taxNumber, logoPath: string | null }}
 */
export function getCompanySettings(db) {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const map = {};
  rows.forEach((r) => { map[r.key] = r.value || ''; });
  const logoPath = getLogoPath();
  return {
    companyName: map.company_name || '',
    phone: map.company_phone || '',
    address: map.company_address || '',
    email: map.company_email || '',
    website: map.company_website || '',
    taxNumber: map.company_tax_number || '',
    logoPath,
  };
}

/**
 * Resolve path to company logo file (data/branding/logo.png or logo.jpg).
 */
export function getLogoPath() {
  if (!fs.existsSync(brandingDir)) return null;
  const names = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp'];
  for (const name of names) {
    const p = path.join(brandingDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Get logo file buffer for embedding (e.g. Excel). Returns null if no logo.
 */
export function getLogoBuffer() {
  const p = getLogoPath();
  if (!p) return null;
  try {
    return fs.readFileSync(p);
  } catch (e) {
    return null;
  }
}

/**
 * Add company header to a PDF document (logo and company name beside each other).
 * @param {PDFKit.PDFDocument} doc
 * @param {ReturnType<getCompanySettings>} company
 * @param {{ title?: string, subtitle?: string }} options
 */
export function addPdfCompanyHeader(doc, company, options = {}) {
  const { title = '', subtitle = '' } = options;
  const margin = doc.page.margins?.left ?? 40;
  const rightMargin = doc.page.margins?.right ?? 40;
  const pageWidth = doc.page.width - margin - rightMargin;
  let y = doc.y;

  const logoHeight = 44;
  const logoWidth = Math.min(140, pageWidth * 0.35);
  let leftContentEnd = margin;

  if (company.logoPath) {
    try {
      doc.image(company.logoPath, margin, y, { fit: [logoWidth, logoHeight] });
      leftContentEnd = margin + logoWidth + 12;
    } catch (e) {
      leftContentEnd = margin;
    }
  }

  const textStartX = leftContentEnd;
  const textWidth = pageWidth - (leftContentEnd - margin);

  if (company.companyName) {
    doc.fontSize(16).font('Helvetica-Bold').text(company.companyName, textStartX, company.logoPath ? y + 4 : y, { width: textWidth });
    y = doc.y + 2;
  }
  const lines = [];
  if (company.address) lines.push(company.address);
  if (company.phone) lines.push(`Tel: ${company.phone}`);
  if (company.email) lines.push(company.email);
  if (company.website) lines.push(company.website);
  if (company.taxNumber) lines.push(`Tax #: ${company.taxNumber}`);
  if (lines.length) {
    doc.fontSize(9).font('Helvetica').text(lines.join('  |  '), textStartX, y, { width: textWidth });
    y = doc.y + 6;
  }
  if (title) {
    doc.fontSize(12).font('Helvetica-Bold').text(title, margin, y);
    y = doc.y + 2;
  }
  if (subtitle) {
    doc.fontSize(10).font('Helvetica').text(subtitle, margin, y);
    y = doc.y + 4;
  }
  doc.y = y + 6;
  doc.moveDown(0.5);
}

/**
 * Add company header rows to an Excel worksheet (logo beside company name, then details).
 * @param {ExcelJS.Worksheet} ws
 * @param {ReturnType<getCompanySettings>} company
 * @param {string} reportTitle
 * @param {ExcelJS.Workbook} wb - workbook (for adding logo image)
 */
export function addExcelCompanyHeader(ws, company, reportTitle = '', wb = null) {
  const logoBuf = wb && company.logoPath ? (() => { try { return fs.readFileSync(company.logoPath); } catch (e) { return null; } })() : null;
  if (logoBuf && wb) {
    const ext = (company.logoPath || '').toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    const imageId = wb.addImage({ buffer: logoBuf, extension: ext });
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 40 } });
  }
  ws.addRow(['', company.companyName || '']); // empty A1 so logo shows, name in B1
  if (company.address) ws.addRow(['Address', company.address]);
  if (company.phone) ws.addRow(['Phone', company.phone]);
  if (company.email) ws.addRow(['Email', company.email]);
  if (company.website) ws.addRow(['Website', company.website]);
  if (company.taxNumber) ws.addRow(['Tax Number', company.taxNumber]);
  if (reportTitle) ws.addRow(['Report', reportTitle]);
  ws.addRow([]);
  const headerRowCount = 1 + (company.address ? 1 : 0) + (company.phone ? 1 : 0) + (company.email ? 1 : 0) + (company.website ? 1 : 0) + (company.taxNumber ? 1 : 0) + (reportTitle ? 1 : 0) + 1;
  for (let i = 1; i <= headerRowCount; i++) {
    const row = ws.getRow(i);
    if (row.getCell(1).value) row.getCell(1).font = { bold: true };
  }
}

export { brandingDir, COMPANY_KEYS };
