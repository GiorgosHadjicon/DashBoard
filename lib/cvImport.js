import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { autoFormatCv } from '../public/logic.js';

const inline = (t) => t.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();

// Word's real structure (heading styles, bullet/numbered lists, bold runs) survives through
// convertToHtml in a way extractRawText's flattened plain text can't — read that instead and turn
// it into the CV tab's own syntax, so a Word CV needs little to no manual re-marking-up afterward.
// Not a full HTML parser — sequential regex passes, innermost tags first, good enough for mammoth's
// own predictable output (this is never attacker-supplied HTML, mammoth generated all of it).
function docxHtmlToCv(html) {
  let s = html;
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${inline(t)}`);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${inline(t)}\n`);
  s = s.replace(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi, (_, t) => `\n## ${inline(t)}\n`);
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${inline(t)}`);
  s = s.replace(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `\n${inline(t)}`);
  s = s.replace(/<[^>]+>/g, ''); // drop leftover wrapper tags: table, tr, ul, ol, tbody…
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Pulls text out of an uploaded PDF or Word CV, auto-formatted into the CV tab's "#"/"##"/"-" syntax
// (see autoFormatCv in public/logic.js) so importing one doesn't mean re-typing the whole thing.
export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    try { return autoFormatCv((await parser.getText()).text); } finally { await parser.destroy(); }
  }
  if (ext === 'docx') return autoFormatCv(docxHtmlToCv((await mammoth.convertToHtml({ buffer })).value));
  throw new Error(`Unsupported file type: .${ext} (expected .txt, .md, .pdf or .docx)`);
}
