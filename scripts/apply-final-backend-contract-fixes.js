const fs = require('fs');

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
  console.log(`[checked] ${path}`);
}

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) {
    console.log(`${label}: already fixed`);
    return source;
  }
  if (!source.includes(oldText)) {
    throw new Error(`${label}: expected source text not found`);
  }
  console.log(`${label}: fixed`);
  return source.replace(oldText, newText);
}

edit('src/controllers/menuController.js', (input) => {
  let output = input;
  output = replaceOnce(output,
`  const requestedContractVersion = String(req.query?.contractVersion || req.query?.version || "").trim().toLowerCase();
  const includeV3 = !requestedContractVersion
    || requestedContractVersion === "v3"
    || requestedContractVersion === "meal_planner_menu.v3";`,
`  // The public planner exposes one canonical Flutter-compatible contract only.
  // Legacy version query parameters are intentionally ignored.`,
  'ignore legacy contract query');

  output = replaceOnce(output,
`    getMealPlannerCatalog({ lang, includeV3, includeV2: includeLegacy || requestedContractVersion === "v2" }),`,
`    getMealPlannerCatalog({ lang, includeV3: true, includeV2: false }),`,
  'force canonical v3 catalog');

  output = output.replace('  const builderCatalogV2 = mealPlannerCatalog?.builderCatalogV2 || null;\n', '');
  output = replaceOnce(output,
`    plannerCatalog: plannerCatalog || { sections: [] },
  };`,
`  };`,
  'remove plannerCatalog response mirror');

  output = output.replace(/  if \(builderCatalogV2\) \{\n    data\.builderCatalogV2 = builderCatalogV2;\n  \}\n\n/, '');
  return output;
});

edit('tests/mealPlanner.integration.test.js', (input) =>
  replaceOnce(input,
    'mongoReplSet.getUri(`meal_planner_integration_${Date.now()}`)',
    'mongoReplSet.getUri("meal_planner_integration_test")',
    'safe integration database name')
);

console.log('Final backend contract fixes applied.');
