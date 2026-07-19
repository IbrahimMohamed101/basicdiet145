from pathlib import Path

TARGET = Path('src/services/dashboard/opsPayloadService.js')
text = TARGET.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)

old_doc = '''  const proteinDoc = resolveCatalogDoc(\n    catalogMaps,\n    "protein",\n    slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId,\n    fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || materializedProduct.proteinFamilyKey\n  );'''
new_doc = '''  const selectedProteinId = premiumSalad && selectedProteinOption\n    ? selectedProteinOption.optionId\n    : null;\n  const selectedProteinKey = premiumSalad && selectedProteinOption\n    ? selectedProteinOption.optionKey\n    : null;\n  const proteinDoc = resolveCatalogDoc(\n    catalogMaps,\n    "protein",\n    selectedProteinId || slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId,\n    selectedProteinKey || fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || materializedProduct.proteinFamilyKey\n  );'''
if old_doc in text:
    replace_once(old_doc, new_doc, 'canonical protein catalog lookup')
elif 'const selectedProteinId = premiumSalad && selectedProteinOption' not in text:
    raise SystemExit('protein catalog lookup block not found')

old_id = '''    proteinId: stringifyId(slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId),'''
new_id = '''    proteinId: stringifyId(selectedProteinId || slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId),'''
if old_id in text:
    replace_once(old_id, new_id, 'canonical protein id priority')

old_key = '''    proteinKey: slot.proteinKey\n      || fulfillment.proteinKey\n      || confirmation.proteinKey\n      || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))\n      || (selectedProteinOption && selectedProteinOption.optionKey)\n      || slot.proteinFamilyKey\n      || null,'''
new_key = '''    proteinKey: selectedProteinKey\n      || slot.proteinKey\n      || fulfillment.proteinKey\n      || confirmation.proteinKey\n      || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))\n      || slot.proteinFamilyKey\n      || null,'''
if old_key in text:
    replace_once(old_key, new_key, 'canonical protein key priority')

old_name = '''    proteinName: snapshotName(confirmation, ["protein", "name"], lang)\n      || snapshotName(display, ["protein", "name"], lang)\n      || localizedName(\n        fulfillment.proteinName\n          || (selectedProteinOption && (selectedProteinOption.nameI18n || selectedProteinOption.name))\n          || (proteinDoc && proteinDoc.name),\n        lang\n      ),'''
new_name = '''    proteinName: (premiumSalad && selectedProteinOption\n      ? localizedName(selectedProteinOption.nameI18n || selectedProteinOption.name, lang)\n      : "")\n      || snapshotName(confirmation, ["protein", "name"], lang)\n      || snapshotName(display, ["protein", "name"], lang)\n      || localizedName(fulfillment.proteinName || (proteinDoc && proteinDoc.name), lang),'''
if old_name in text:
    replace_once(old_name, new_name, 'canonical protein name priority')

old_i18n = '''    proteinNameI18n: localizedNameObject(\n      (confirmation.protein && confirmation.protein.name)\n        || (display.protein && display.protein.name)\n        || fulfillment.proteinName\n        || (selectedProteinOption && (selectedProteinOption.nameI18n || selectedProteinOption.name))\n        || (proteinDoc && proteinDoc.name),\n      fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || ""\n    ),'''
new_i18n = '''    proteinNameI18n: localizedNameObject(\n      (premiumSalad && selectedProteinOption && (selectedProteinOption.nameI18n || selectedProteinOption.name))\n        || (confirmation.protein && confirmation.protein.name)\n        || (display.protein && display.protein.name)\n        || fulfillment.proteinName\n        || (proteinDoc && proteinDoc.name),\n      selectedProteinKey || fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || ""\n    ),'''
if old_i18n in text:
    replace_once(old_i18n, new_i18n, 'canonical protein i18n priority')

TARGET.write_text(text)
print('canonical premium salad protein priority applied')
