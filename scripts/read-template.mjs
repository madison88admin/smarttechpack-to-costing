import fs from 'fs';
import path from 'path';

// Read the xlsx file as a zip and extract sheet data
const filePath = 'C:\\Users\\JC\\Downloads\\FTY CBD - template.xlsx';

if (!fs.existsSync(filePath)) {
  console.log('File not found:', filePath);
  process.exit(1);
}

const stats = fs.statSync(filePath);
console.log('File size:', (stats.size / 1024).toFixed(1), 'KB');

// Use xlsx library if available, otherwise try manual parse
try {
  const XLSX = await import('xlsx');
  const workbook = XLSX.readFile(filePath);
  console.log('\nSheet names:', workbook.SheetNames);
  
  for (const sheetName of workbook.SheetNames) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SHEET: ${sheetName}`);
    console.log('='.repeat(80));
    
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    console.log(`Range: ${sheet['!ref']}`);
    console.log(`Rows: ${range.e.r - range.s.r + 1}, Cols: ${range.e.c - range.s.c + 1}`);
    
    // Get all cells as array of arrays
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    
    rows.forEach((row, i) => {
      // Skip completely empty rows
      const hasData = row.some(cell => cell !== '' && cell !== null && cell !== undefined);
      if (!hasData) return;
      
      const cells = row.map((cell, j) => {
        const colLetter = XLSX.utils.encode_col(j);
        if (cell === '' || cell === null || cell === undefined) return '';
        return `${colLetter}:${cell}`;
      }).filter(c => c !== '');
      
      console.log(`Row ${i + 1}: ${cells.join(' | ')}`);
    });
    
    // Check for merged cells
    if (sheet['!merges']) {
      console.log(`\nMerged cells (${sheet['!merges'].length}):`);
      sheet['!merges'].forEach(m => {
        const s = XLSX.utils.encode_cell(m.s);
        const e = XLSX.utils.encode_cell(m.e);
        console.log(`  ${s}:${e}`);
      });
    }
  }
} catch (e) {
  console.log('xlsx library not available, trying manual parse...');
  console.log('Error:', e.message);
}
