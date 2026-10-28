export function normalizeSaudiPhone(value: string): string {
  const digits = value.replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
  let local = digits.replace(/[\s()\-]/g, "");
  if (local.startsWith("+966")) local = local.slice(4);
  else if (local.startsWith("966")) local = local.slice(3);
  else if (local.startsWith("0")) local = local.slice(1);
  return /^5\d{8}$/.test(local) ? "+966" + local : "";
}
