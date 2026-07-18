const fs = require('fs');

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) {
    console.log(`${label}: already aligned`);
    return source;
  }
  if (!source.includes(oldText)) {
    throw new Error(`${label}: neither old nor aligned text was found`);
  }
  console.log(`${label}: aligned`);
  return source.replace(oldText, newText);
}

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
  console.log(`[checked] ${path}`);
}

edit('tests/mealPlanner.integration.test.js', (input) => {
  let output = input;
  output = replaceOnce(output,
`    assertTrue(!!defaultRes.body.data?.builderCatalogV2, 'default v3 response keeps builderCatalogV2 compatibility mirror');
    assertTrue(!!defaultRes.body.data?.plannerCatalog, 'default plannerCatalog');
    assertEqual(defaultRes.body.data?.plannerCatalog?.contractVersion, 'meal_planner_menu.v3', 'default plannerCatalog v3 contract');`,
`    assertEqual(Object.prototype.hasOwnProperty.call(defaultRes.body.data || {}, 'builderCatalogV2'), false, 'default response has no builderCatalogV2 mirror');
    assertEqual(Object.prototype.hasOwnProperty.call(defaultRes.body.data || {}, 'plannerCatalog'), false, 'default response has no plannerCatalog mirror');
    assertEqual(defaultRes.body.data?.builderCatalog?.contractVersion, 'meal_planner_menu.v3', 'default builderCatalog v3 contract');`,
  'single canonical public catalog');

  output = output
    .replace(/explicit builderCatalogV2 exposes premium meal compatibility section/g, 'legacy contract query exposes canonical premium meal section')
    .replace(/res\.body\.data\?\.builderCatalogV2/g, 'res.body.data?.builderCatalog')
    .replace(/builderCatalogV2 premium_meal section present when v2 is requested/g, 'canonical premium_meal section present')
    .replace(/builderCatalogV2 premium_meal virtual product present/g, 'canonical premium_meal virtual product present')
    .replace(/builderCatalogV2 premium protein group present/g, 'canonical premium protein group present')
    .replace(/explicit builderCatalogV2 has premium_large_salad compatibility product/g, 'canonical builderCatalog has premium_large_salad product')
    .replace(/explicit builderCatalogV2 sandwich section does not leak non-sandwich products/g, 'canonical sandwich section does not leak non-sandwich products')
    .replace(/builderCatalogV2 sandwich section present when v2 is requested/g, 'canonical sandwich section present');

  output = replaceOnce(output,
`  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);`,
`  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);`,
  'active subscription fixture');

  output = replaceOnce(output,
`    assertEqual(res.status, 400, 'status');
    const errCode = res.body.error?.code;
    assertTrue(errCode === 'INVALID' || errCode === 'INVALID_ONE_TIME_ADDON_SELECTION', 'plan add-on request rejected');`,
`    assertEqual(res.status, 402, 'plan add-on selection requires payment');
    const paymentRequirement = res.body.paymentRequirement || res.body.error?.details?.paymentRequirement;
    assertTrue(!!paymentRequirement, 'payment requirement returned');`,
  'plan add-on payment requirement');

  return output;
});

edit('tests/oneTimeMenuCatalog.test.js', (input) => {
  let output = input;
  output = replaceOnce(output,
`      assert(res.body.data.plannerCatalog, "endpoint includes plannerCatalog");
      assert(res.body.data.builderCatalogV2, "default v3 response includes builderCatalogV2 compatibility mirror");`,
`      assert.strictEqual(res.body.data.plannerCatalog, undefined, "endpoint omits plannerCatalog mirror");
      assert.strictEqual(res.body.data.builderCatalogV2, undefined, "endpoint omits builderCatalogV2 mirror");`,
  'one-time public root');
  output = replaceOnce(output,
`      const v2Res = await api.get("/api/subscriptions/meal-planner-menu?lang=en&contractVersion=v2");
      expectStatus(v2Res, 200, "subscription meal planner menu v2 compatibility");
      assert(v2Res.body.data.builderCatalogV2, "explicit v2 request includes builderCatalogV2");
      assert.strictEqual(v2Res.body.data.builderCatalogV2.catalogVersion, "meal_planner_menu.v2");`,
`      const v2Res = await api.get("/api/subscriptions/meal-planner-menu?lang=en&contractVersion=v2");
      expectStatus(v2Res, 200, "subscription meal planner menu legacy query compatibility");
      assert(v2Res.body.data.builderCatalog, "legacy query returns canonical builderCatalog");
      assert.strictEqual(v2Res.body.data.builderCatalog.contractVersion, "meal_planner_menu.v3");
      assert.strictEqual(v2Res.body.data.builderCatalogV2, undefined, "legacy query does not restore v2 mirror");`,
  'one-time legacy query');
  return output;
});

edit('tests/mealBuilderDashboardMobileParity.test.js', (input) => {
  let output = input;
  output = replaceOnce(output,
`  const mobileProduct = findPlannerProduct(res.body.data.plannerCatalog, fixture.product.id);
  const mobileGroup = findProductGroup(mobileProduct, fixture.group.id);`,
`  const mobileProduct = findPlannerProduct(res.body.data.builderCatalog, fixture.product.id);
  const mobileGroup = findProductGroup(mobileProduct, fixture.group.id);`,
  'mobile parity product source');
  output = output.replace('plannerCatalog: res.body.data.plannerCatalog', 'plannerCatalog: res.body.data.builderCatalog');
  return output;
});

console.log('Current backend contract tests are aligned.');
