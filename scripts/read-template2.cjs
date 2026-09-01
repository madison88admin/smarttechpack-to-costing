const XLSX = require('xlsx');
const wb = XLSX.readFile('C:\\Users\\JC\\Downloads\\FTY CBD - template.xlsx');
const sheet = wb.Sheets['flat option'];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

console.log('=== FULL TEMPLATE (all rows) ===\n');
rows.forEach((row, i) => {
  console.log(`Row ${i+1}:`);
  row.forEach((cell, j) => {
    if (cell !== '' && cell !== null && cell !== undefined) {
      console.log(`  ${XLSX.utils.encode_col(j)}${i+1} = ${JSON.stringify(cell)}`);
    }
  });
});

// Check column widths
if (sheet['!cols']) {
  console.log('\nColumn widths:');
  sheet['!cols'].forEach((c, i) => {
    if (c.wpx) console.log(`  ${XLSX.utils.encode_col(i)}: ${c.wpx}px`);
  });
}
