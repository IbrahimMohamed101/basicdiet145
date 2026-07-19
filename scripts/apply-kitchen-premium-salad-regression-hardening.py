from pathlib import Path

TARGET = Path('tests/kitchenPremiumSaladProjectionFallback.test.js')
text = TARGET.read_text()

old_id = '    proteinId: selectedOptions[0].optionId,\n'
new_id = '    proteinId: staleProtein.id,\n'
if old_id in text:
    text = text.replace(old_id, new_id, 1)
elif new_id not in text:
    raise SystemExit('test protein id marker not found')

old_call = 'const kitchenDetails = buildKitchenDetailsPayload(day, { selectedGrams: 100 }, "ar", {});\n'
new_call = '''const catalogMaps = {\n  proteinById: new Map([[staleProtein.id, {\n    _id: staleProtein.id,\n    key: staleProtein.key,\n    proteinFamilyKey: staleProtein.key,\n    name: staleProtein.name,\n  }]]),\n};\nconst kitchenDetails = buildKitchenDetailsPayload(day, { selectedGrams: 100 }, "ar", catalogMaps);\n'''
if old_call in text:
    text = text.replace(old_call, new_call, 1)
elif 'const catalogMaps = {' not in text:
    raise SystemExit('test catalog map marker not found')

TARGET.write_text(text)
print('premium salad stale protein regression hardened')
