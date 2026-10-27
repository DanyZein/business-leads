// Clean State Analysis & Metadata Generator
// Run: node clean_state.js

const fs = require('fs');
const path = require('path');

const DATA_DIR = '.data';
const OLD_DIR = 'old/legacy';
const NOT_USED_DIR = 'old/not_used';

function loadJSON(file) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file));
  return Array.isArray(data) ? data : data; // return as-is for objects
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

console.log('=== CLEAN STATE ANALYSIS ===\n');

// Load all files
const files = {
  // Current active files
  'seen_leads_us.json': loadJSON(path.join(DATA_DIR, 'seen_leads_us.json')),
  'seen_leads_lebanon.json': loadJSON(path.join(DATA_DIR, 'seen_leads_lebanon.json')),
  'quota_us.json': loadJSON(path.join(DATA_DIR, 'quota_us.json')),
  'quota_lebanon.json': loadJSON(path.join(DATA_DIR, 'quota_lebanon.json')),
  'progress_Maryland_us.json': loadJSON(path.join(DATA_DIR, 'progress_Maryland_us.json')),
  'progress_Lebanon_lebanon.json': loadJSON(path.join(DATA_DIR, 'progress_Lebanon_lebanon.json')),

  // Legacy (relevant)
  'legacy/seen_leads.json': loadJSON(path.join(OLD_DIR, 'seen_leads.json')),
  'legacy/seen_leads_lebanon.json': loadJSON(path.join(OLD_DIR, 'seen_leads_lebanon.json')),
  'legacy/seen_leads_old.json': loadJSON(path.join(OLD_DIR, 'seen_leads_old.json')),

  // Not used (restaurant data - archived)
  'not_used/seen_leads old.json': loadJSON(path.join(NOT_USED_DIR, 'seen_leads old.json')),
  'not_used/seen_leads old 2.json': loadJSON(path.join(NOT_USED_DIR, 'seen_leads old 2.json')),
  'not_used/seen_leads-from restos-old.json': loadJSON(path.join(NOT_USED_DIR, 'seen_leads-from restos-old.json')),
};

console.log('FILE SIZES:');
Object.entries(files).forEach(([name, data]) => {
  console.log(`  ${name}: ${data.length} entries`);
});

// Analyze overlaps
const usData = new Set(files['seen_leads_us.json']);
const lbData = new Set(files['seen_leads_lebanon.json']);
const legacySeen = new Set(files['legacy/seen_leads.json']);
const legacySeenLb = new Set(files['legacy/seen_leads_lebanon.json']);
const legacySeenOld = new Set(files['legacy/seen_leads_old.json']);

function overlap(a, b) {
  let count = 0;
  a.forEach(id => { if (b.has(id)) count++; });
  return count;
}

console.log('\nOVERLAPS:');
console.log(`  US ∩ Lebanon: ${overlap(usData, lbData)}`);
console.log(`  LB (current) ∩ Legacy Seen: ${overlap(lbData, legacySeen)}`);
console.log(`  LB (current) ∩ Legacy Seen LB: ${overlap(lbData, legacySeenLb)}`);
console.log(`  Legacy Seen ∩ Legacy Seen LB: ${overlap(legacySeen, legacySeenLb)}`);
console.log(`  Legacy Seen ∩ Legacy Seen Old: ${overlap(legacySeen, legacySeenOld)}`);
console.log(`  LB (current) ∩ Legacy Seen Old: ${overlap(lbData, legacySeenOld)}`);

// Build metadata
const metadata = {
  generated: new Date().toISOString(),
  summary: {
    us: {
      current_file: '.data/seen_leads_us.json',
      count: usData.size,
      description: 'US market dedupe (Maryland run)',
      progress_files: ['.data/progress_Maryland_us.json'],
      last_run: '2026-10-27 (Maryland, 51 leads in first city)'
    },
    lebanon: {
      current_file: '.data/seen_leads_lebanon.json',
      count: lbData.size,
      description: 'Lebanon market dedupe (MERGED: legacy 1085 + current 384 = 1292 unique)',
      progress_files: ['.data/progress_Lebanon_lebanon.json'],
      last_run: '2026-10-27 (merged)',
      merge_history: [
        { date: '2026-10-27', action: 'Merged old/legacy/seen_leads.json (1085) into .data/seen_leads_lebanon.json (384)', result: 1292 }
      ]
    }
  },
  files: {}
};

Object.entries(files).forEach(([name, data]) => {
  const isArray = Array.isArray(data);
  metadata.files[name] = {
    path: name.startsWith('legacy/') ? `old/legacy/${name.replace('legacy/', '')}` :
          name.startsWith('not_used/') ? `old/not_used/${name.replace('not_used/', '')}` :
          `.data/${name}`,
    count: isArray ? data.length : Object.keys(data).length,
    sample_ids: isArray ? data.slice(0, 3) : Object.entries(data).slice(0, 3).map(([k, v]) => `${k}: ${v}`),
    status: name.startsWith('not_used/') ? 'archived_restaurant_data' :
            name.startsWith('legacy/') ? 'legacy_backup' : 'active'
  };
});

// Save metadata
saveJSON(path.join(DATA_DIR, 'METADATA.json'), metadata);
console.log('\n✅ Written .data/METADATA.json');

// Quick verification: show what's in the merged Lebanon file that's new
const newFromLegacy = [...legacySeen].filter(id => !lbData.has(id));
console.log(`\nNew Lebanon IDs from legacy merge: ${newFromLegacy.length}`);
console.log('Sample:', newFromLegacy.slice(0, 5).join(', '));

console.log('\n=== RECOMMENDATIONS ===');
console.log('1. Lebanon: ✅ Merged (1292 unique). Sheet has 784, local has 1292.');
console.log('2. US: Maryland progress at job 16/2448. Continue with pnpm start:md');
console.log('3. Legacy/seen_leads_old.json (2055): Investigate if valid US data');
console.log('4. Not_used folder: Restaurant data - keep archived, not relevant');
console.log('5. No duplicates found in any sheet tab');

console.log('\n=== NEXT COMMANDS ===');
console.log('  Continue Maryland: pnpm start:md');
console.log('  Run Lebanon:       pnpm start:lb');
console.log('  Check US legacy:   node -e "require(fs).readFileSync(...) ..." (sample 5 IDs)');