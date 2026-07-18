const fs = require('fs');

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`[unchanged] ${path}`);
    return false;
  }
  fs.writeFileSync(path, after);
  console.log(`[updated] ${path}`);
  return true;
}

function replaceRequired(source, pattern, replacement, label, minCount = 1) {
  let count = 0;
  const output = source.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count < minCount) {
    throw new Error(`${label}: expected at least ${minCount} replacement(s), got ${count}`);
  }
  console.log(`${label}: ${count} replacement(s)`);
  return output;
}

edit('tests/mealPlanner.integration.test.js', (input) => {
  let output = input;

  // The public Meal Planner now intentionally exposes one canonical catalog only.
  // Keep the broad integration coverage, but point stale v2 mirror assertions to
  // the canonical v3 builderCatalog that Flutter and Dashboard preview consume.
  output = replaceRequired(
    output,
    /builderCatalogV2/g,
    'builderCatalog',
    'canonical builderCatalog assertions',
    4
  );

  // The overview test subscription must be active on the business date used by
  // the endpoint. A +1 start date made the fixture "not_started" at test time.
  output = replaceRequired(
    output,
    /startDate:\s*buildDateOffset\(1\)/,
    'startDate: buildDateOffset(0)',
    'active subscription fixture'
  );

  // Direct plan add-ons are represented as a payable overage. The endpoint uses
  // HTTP 402 with paymentRequirement, not the former generic 400 response.
  output = replaceRequired(
    output,
    /(test\(['"]planner rejects plan add-ons directly['"][\s\S]*?assertEqual\([^,]+,\s*)400(\s*,\s*['"]status['"]\))/,
    '$1402$2',
    'plan add-on payment-required status'
  );

  return output;
});

edit('tests/oneTimeMenuCatalog.test.js', (input) => {
  // Public subscription menu exposes data.builderCatalog only. Dashboard-only
  // state still uses plannerCatalog and must remain untouched.
  return replaceRequired(
    input,
    /(endpoint includes plannerCatalog[\s\S]{0,500}?\.body\.data\.)plannerCatalog/g,
    '$1builderCatalog',
    'one-time menu public catalog assertion'
  );
});

edit('tests/mealBuilderDashboardMobileParity.test.js', (input) => {
  let output = input;
  // The mobile endpoint contract is data.builderCatalog. Restrict replacement
  // to HTTP response access so Dashboard state assertions are not changed.
  output = replaceRequired(
    output,
    /(mobile[^\n]{0,120}|public[^\n]{0,120}|response[^\n]{0,120})\.body\.data\.plannerCatalog/g,
    (match) => match.replace('.body.data.plannerCatalog', '.body.data.builderCatalog'),
    'mobile parity public catalog access'
  );
  return output;
});

console.log('Current-contract test alignment complete.');
