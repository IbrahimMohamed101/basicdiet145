from pathlib import Path

OPS = Path('src/services/dashboard/opsPayloadService.js')
PROJECTION = Path('src/services/dashboard/kitchenProjectionService.js')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)

ops = OPS.read_text()

helper = r'''
function canonicalSelectedOptionGroupKey(option = {}) {
  const key = String(option.canonicalGroupKey || option.groupKey || "").trim().toLowerCase();
  if (key === "vegetables_legumes") return "vegetables";
  if (key === "proteins") return "protein";
  if (key === "sauces") return "sauce";
  return key;
}

function selectedOptionLookupKeys(option = {}) {
  const groupId = stringifyId(option.groupId) || "";
  const optionId = stringifyId(option.optionId || option.id || option._id) || "";
  const groupKey = canonicalSelectedOptionGroupKey(option);
  const optionKey = String(option.optionKey || option.key || "").trim();
  return [
    groupId && optionId ? `id:${groupId}:${optionId}` : "",
    optionId ? `option:${optionId}` : "",
    groupKey && optionKey ? `key:${groupKey}:${optionKey}` : "",
    optionKey ? `optionKey:${optionKey}` : "",
  ].filter(Boolean);
}

function buildSelectedOptionLookup(options = []) {
  const lookup = new Map();
  for (const option of Array.isArray(options) ? options : []) {
    if (!option || typeof option !== "object") continue;
    for (const key of selectedOptionLookupKeys(option)) {
      if (!lookup.has(key)) lookup.set(key, option);
    }
  }
  return lookup;
}

function findSelectedOptionSnapshot(lookup, option = {}) {
  for (const key of selectedOptionLookupKeys(option)) {
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

function resolveMealSlotSelectedOptionInputs(slot = {}) {
  const rawOptions = Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [];
  const displayOptions = slot.displaySnapshot && Array.isArray(slot.displaySnapshot.groups)
    ? slot.displaySnapshot.groups
    : [];
  const confirmationOptions = slot.confirmationSnapshot && Array.isArray(slot.confirmationSnapshot.selectedOptions)
    ? slot.confirmationSnapshot.selectedOptions
    : [];
  const snapshotOptions = displayOptions.length > 0 ? displayOptions : confirmationOptions;
  if (rawOptions.length === 0) return snapshotOptions;
  if (snapshotOptions.length === 0) return rawOptions;

  const snapshotLookup = buildSelectedOptionLookup(snapshotOptions);
  const rawIsSnapshotSubset = rawOptions.every((option) => Boolean(findSelectedOptionSnapshot(snapshotLookup, option)));
  const authoritativeOptions = snapshotOptions.length > rawOptions.length && rawIsSnapshotSubset
    ? snapshotOptions
    : rawOptions;
  const rawLookup = buildSelectedOptionLookup(rawOptions);

  return authoritativeOptions.map((option) => {
    const raw = findSelectedOptionSnapshot(rawLookup, option) || {};
    const snapshot = findSelectedOptionSnapshot(snapshotLookup, option) || {};
    return {
      ...snapshot,
      ...raw,
      ...option,
      groupName: option.groupName || raw.groupName || snapshot.groupName || snapshot.groupLabel || snapshot.group,
      optionName: option.optionName || raw.optionName || snapshot.optionName,
      name: option.name || raw.name || snapshot.name || snapshot.optionName || snapshot.label,
    };
  });
}
'''.strip('\n')

if 'function resolveMealSlotSelectedOptionInputs' not in ops:
    ops = replace_once(
        ops,
        '\nfunction classifyOptions(options, matcher) {',
        '\n' + helper + '\n\nfunction classifyOptions(options, matcher) {',
        'insert selected-option snapshot helpers',
    )

old_selected = '''  const selectedOptions = dedupeSelectedOptions(\n    (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])\n      .map((option) => normalizeSelectedOption(hydrateSelectedOption(option, catalogMaps, lang), lang))\n  );'''
new_selected = '''  const selectedOptions = dedupeSelectedOptions(\n    resolveMealSlotSelectedOptionInputs(slot)\n      .map((option) => normalizeSelectedOption(hydrateSelectedOption(option, catalogMaps, lang), lang))\n  );\n  const selectedProteinOption = selectedOptions.find((option) => (\n    canonicalSelectedOptionGroupKey(option) === "protein"\n  )) || null;'''
if old_selected in ops:
    ops = replace_once(ops, old_selected, new_selected, 'hydrate selected options from persisted snapshot')
elif 'const selectedProteinOption = selectedOptions.find' not in ops:
    raise SystemExit('selected-options block not found')

old_protein_key = '''      || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))\n      || slot.proteinFamilyKey\n      || null,'''
new_protein_key = '''      || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))\n      || (selectedProteinOption && selectedProteinOption.optionKey)\n      || slot.proteinFamilyKey\n      || null,'''
if old_protein_key in ops:
    ops = replace_once(ops, old_protein_key, new_protein_key, 'protein key snapshot fallback')

old_protein_name = '''    proteinName: snapshotName(confirmation, ["protein", "name"], lang)\n      || snapshotName(display, ["protein", "name"], lang)\n      || localizedName(fulfillment.proteinName || (proteinDoc && proteinDoc.name), lang),'''
new_protein_name = '''    proteinName: snapshotName(confirmation, ["protein", "name"], lang)\n      || snapshotName(display, ["protein", "name"], lang)\n      || localizedName(\n        fulfillment.proteinName\n          || (selectedProteinOption && (selectedProteinOption.nameI18n || selectedProteinOption.name))\n          || (proteinDoc && proteinDoc.name),\n        lang\n      ),'''
if old_protein_name in ops:
    ops = replace_once(ops, old_protein_name, new_protein_name, 'protein name snapshot fallback')

old_protein_i18n = '''      (confirmation.protein && confirmation.protein.name)\n        || (display.protein && display.protein.name)\n        || fulfillment.proteinName\n        || (proteinDoc && proteinDoc.name),'''
new_protein_i18n = '''      (confirmation.protein && confirmation.protein.name)\n        || (display.protein && display.protein.name)\n        || fulfillment.proteinName\n        || (selectedProteinOption && (selectedProteinOption.nameI18n || selectedProteinOption.name))\n        || (proteinDoc && proteinDoc.name),'''
if old_protein_i18n in ops:
    ops = replace_once(ops, old_protein_i18n, new_protein_i18n, 'protein i18n snapshot fallback')

OPS.write_text(ops)

projection = PROJECTION.read_text()
start_marker = 'function selectedOptionToSaladItem(option = {}) {'
end_marker = 'function buildSaladSections(slot = {}) {'
start = projection.find(start_marker)
end = projection.find(end_marker, start)
if start < 0 or end < 0:
    if 'function buildPremiumSaladSnapshotLookup' not in projection:
        raise SystemExit('premium salad projection block markers not found')
else:
    new_block = r'''function premiumSaladSelectionLookupKeys(option = {}) {
  const groupId = asId(option.groupId) || "";
  const optionId = asId(option.optionId || option.id || option._id || option.ingredientId) || "";
  const groupKey = canonicalPremiumSaladGroupKey(option.canonicalGroupKey || option.groupKey);
  const optionKey = String(option.optionKey || option.key || option.ingredientKey || "").trim();
  return [
    groupId && optionId ? `id:${groupId}:${optionId}` : "",
    optionId ? `option:${optionId}` : "",
    groupKey && optionKey ? `key:${groupKey}:${optionKey}` : "",
    optionKey ? `optionKey:${optionKey}` : "",
  ].filter(Boolean);
}

function addPremiumSaladLookupEntry(lookup, option) {
  if (!option || typeof option !== "object") return;
  for (const key of premiumSaladSelectionLookupKeys(option)) {
    if (!lookup.has(key)) lookup.set(key, option);
  }
}

function buildPremiumSaladSnapshotLookup(slot = {}) {
  const lookup = new Map();
  const confirmationSelections = slot.confirmationSnapshot
    && Array.isArray(slot.confirmationSnapshot.selectedOptions)
    ? slot.confirmationSnapshot.selectedOptions
    : [];
  const displaySelections = slot.displaySnapshot
    && Array.isArray(slot.displaySnapshot.groups)
    ? slot.displaySnapshot.groups
    : [];

  displaySelections.forEach((option) => addPremiumSaladLookupEntry(lookup, option));
  confirmationSelections.forEach((option) => addPremiumSaladLookupEntry(lookup, option));
  return lookup;
}

function buildPremiumSaladSourceLookup(sourceGroups = {}) {
  const lookup = new Map();
  for (const [rawKey, values] of Object.entries(sourceGroups)) {
    const groupKey = canonicalPremiumSaladGroupKey(rawKey);
    for (const value of Array.isArray(values) ? values : []) {
      const item = value && typeof value === "object" ? value : { id: value };
      addPremiumSaladLookupEntry(lookup, {
        ...item,
        groupKey,
        canonicalGroupKey: groupKey,
        optionId: item.optionId || item.id || item._id || item.ingredientId,
        optionKey: item.optionKey || item.key || item.ingredientKey,
      });
    }
  }
  return lookup;
}

function findPremiumSaladLookupEntry(lookup, option = {}) {
  for (const key of premiumSaladSelectionLookupKeys(option)) {
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

function selectedOptionToSaladItem(option = {}, snapshot = {}, sourceItem = {}) {
  return {
    id: asId(
      option.optionId || option.id || option._id || option.ingredientId
      || snapshot.optionId || snapshot.id || snapshot._id || snapshot.ingredientId
      || sourceItem.optionId || sourceItem.id || sourceItem._id || sourceItem.ingredientId
    ),
    key: option.optionKey || option.key || option.ingredientKey
      || snapshot.optionKey || snapshot.key || snapshot.ingredientKey
      || sourceItem.optionKey || sourceItem.key || sourceItem.ingredientKey
      || null,
    nameI18n: option.nameI18n || option.name || option.optionName || option.label
      || snapshot.optionName || snapshot.nameI18n || snapshot.name || snapshot.label
      || sourceItem.nameI18n || sourceItem.name || sourceItem.label
      || "",
    quantity: Math.max(1, Number(
      option.quantity || option.qty || snapshot.quantity || sourceItem.quantity || 1
    )),
  };
}

function buildPremiumSaladGroups(slot = {}) {
  const sourceGroups = slot.salad && slot.salad.groups && typeof slot.salad.groups === "object"
    ? slot.salad.groups
    : {};
  const selectedOptions = Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [];
  const confirmationSelections = slot.confirmationSnapshot
    && Array.isArray(slot.confirmationSnapshot.selectedOptions)
    ? slot.confirmationSnapshot.selectedOptions
    : [];
  const displaySelections = slot.displaySnapshot
    && Array.isArray(slot.displaySnapshot.groups)
    ? slot.displaySnapshot.groups
    : [];
  const authoritativeSelections = selectedOptions.length > 0
    ? selectedOptions
    : (displaySelections.length > 0 ? displaySelections : confirmationSelections);
  const groups = {};

  if (authoritativeSelections.length === 0) {
    for (const [rawKey, values] of Object.entries(sourceGroups)) {
      if (!Array.isArray(values)) continue;
      const key = canonicalPremiumSaladGroupKey(rawKey);
      if (!key) continue;
      groups[key] = mergeSaladGroupValues({
        existing: groups[key] || [],
        incoming: values,
      }, ["existing", "incoming"]);
    }
    return groups;
  }

  const snapshotLookup = buildPremiumSaladSnapshotLookup(slot);
  const sourceLookup = buildPremiumSaladSourceLookup(sourceGroups);

  for (const option of authoritativeSelections) {
    if (!option || typeof option !== "object") continue;
    const key = canonicalPremiumSaladGroupKey(option.canonicalGroupKey || option.groupKey);
    if (!key) continue;
    const snapshot = findPremiumSaladLookupEntry(snapshotLookup, option) || {};
    const sourceItem = findPremiumSaladLookupEntry(sourceLookup, option) || {};
    const item = selectedOptionToSaladItem(option, snapshot, sourceItem);
    if (!item.id && !item.key && !nameI18n(item.nameI18n).ar) continue;
    groups[key] = mergeSaladGroupValues({
      existing: groups[key] || [],
      incoming: [item],
    }, ["existing", "incoming"]);
  }

  return groups;
}

'''
    projection = projection[:start] + new_block + projection[end:]

PROJECTION.write_text(projection)
print('kitchen premium salad snapshot patch applied')
