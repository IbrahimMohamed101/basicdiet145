const ARABIC_NORMALIZATION_MAP = {
  'هلينو': 'هالينو',
  'ا ل': 'ال',
  'ُ': '',
  'َ': '',
  'ً': '',
  'ٌ': '',
  'ٍ': '',
  'ْ': '',
  'ّ': '',
  'ئ': 'ئ',
  'ؤ': 'ؤ',
  'أ': 'أ',
  'آ': 'آ',
  'ة': 'ة',
};

function isValidArabicChar(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) ||
         (code >= 0x0750 && code <= 0x077F) ||
         (code >= 0x08A0 && code <= 0x08FF) ||
         (code >= 0xFB50 && code <= 0xFDFF) ||
         (code >= 0xFE70 && code <= 0xFEFF);
}

function isValidUnicodeChar(char) {
  const code = char.charCodeAt(0);
  if (code === 0xFFFD) return false;
  if (code >= 0xD800 && code <= 0xDFFF) return false;
  return true;
}

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  if (!str) return str;

  let sanitized = '';
  for (const char of str) {
    if (isValidUnicodeChar(char)) {
      sanitized += char;
    }
  }

  for (const [corrupted, correct] of Object.entries(ARABIC_NORMALIZATION_MAP)) {
    sanitized = sanitized.replace(new RegExp(corrupted, 'g'), correct);
  }

  return sanitized;
}

function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);

  // Handle Dates - return as is so JSON.stringify can handle them
  if (obj instanceof Date || (obj.constructor && obj.constructor.name === 'Date')) {
    return obj;
  }

  // Handle ObjectIds - return as is so JSON.stringify can handle them via toJSON()
  if (
    obj._bsontype === 'ObjectId' || 
    (obj.constructor && obj.constructor.name === 'ObjectId')
  ) {
    return obj;
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  // Handle Mongoose documents or objects with toObject
  const plain = (typeof obj.toObject === 'function') 
    ? obj.toObject() 
    : obj;

  const sanitized = {};
  for (const [key, value] of Object.entries(plain)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
}

function validateUtf8(str) {
  if (typeof str !== 'string') return true;
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoded = encoder.encode(str);
    decoder.decode(encoded);
    return true;
  } catch (e) {
    return false;
  }
}

function validateAndFixResponse(data) {
  const validated = sanitizeObject(data);
  return validated;
}

module.exports = {
  sanitizeString,
  sanitizeObject,
  validateUtf8,
  validateAndFixResponse,
  isValidArabicChar,
  isValidUnicodeChar,
};