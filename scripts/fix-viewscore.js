const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'src', 'pages', 'ViewScore.jsx');
let s = fs.readFileSync(p, 'utf8');
// Remove zebra class rows
s = s.replace(/className=\"odd:bg-white even:bg-slate-50\"/g, '');
// Normalize any escaped className occurrences
s = s.replace(/className=\\\"px-3 py-2 border\\\"/g, 'className="px-3 py-2 border"');
// Replace broken em-dash artifacts and weird quotes with hyphen
s = s.replace(/[\uFFFD][^'">}]*/g, '-');
// Ensure any remaining placeholder em-dash like sequences become hyphen
s = s.replace(/—/g, '-');
fs.writeFileSync(p, s);
console.log('Fixed ViewScore.jsx');

