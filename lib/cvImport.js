import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

// Pulls plain text out of an uploaded PDF or Word CV, so importing one doesn't require re-typing it.
// Formatting (headings, bullets) doesn't survive — the result is a starting point to mark up with
// the CV tab's own #/##/- syntax, not a faithful conversion.
export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  if (ext === 'docx') return (await mammoth.extractRawText({ buffer })).value;
  throw new Error(`Unsupported file type: .${ext} (expected .txt, .md, .pdf or .docx)`);
}
