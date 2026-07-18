const fs = require('fs');
const path = 'src/controllers/menuController.js';
const before = fs.readFileSync(path, 'utf8');
const stale = '    plannerCatalog: plannerCatalog || { sections: [] },\n';
const after = before.replace(stale, '');
if (after === before && before.includes('plannerCatalog: plannerCatalog ||')) {
  throw new Error('Unable to remove public plannerCatalog mirror');
}
fs.writeFileSync(path, after);
console.log('Public Meal Planner response now exposes builderCatalog only.');
