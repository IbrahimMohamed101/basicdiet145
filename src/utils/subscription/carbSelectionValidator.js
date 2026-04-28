const { isValidObjectId } = require("mongoose");

function validateCarbSelections(carbSelections, carbMap, rules) {
  if (carbSelections === undefined || carbSelections === null) {
    return { valid: true, selections: [] };
  }

  if (!Array.isArray(carbSelections)) {
    return {
      valid: false,
      errorCode: "INVALID_CARB_SELECTIONS",
      errorMessage: "carbSelections must be an array"
    };
  }

  const { maxTypes = 2, maxTotalGrams = 300 } = rules || {};
  
  if (carbSelections.length > maxTypes) {
    return {
      valid: false,
      errorCode: "CARB_TYPES_EXCEEDED",
      errorMessage: `Maximum of ${maxTypes} carb types allowed per meal`
    };
  }

  let totalGrams = 0;
  const seenCarbIds = new Set();
  const processedSelections = [];

  for (const selection of carbSelections) {
    const carbId = String(selection.carbId || "");
    
    if (!isValidObjectId(carbId)) {
      return {
        valid: false,
        errorCode: "INVALID_CARB_ID",
        errorMessage: "Each carb selection must have a valid carbId"
      };
    }

    if (seenCarbIds.has(carbId)) {
      return {
        valid: false,
        errorCode: "DUPLICATE_CARB_SELECTION",
        errorMessage: `Duplicate carbId selected: ${carbId}`
      };
    }
    seenCarbIds.add(carbId);

    const doc = carbMap.get(carbId);
    if (!doc) {
      return {
        valid: false,
        errorCode: "UNKNOWN_CARB_ID",
        errorMessage: `Unknown carbId selected: ${carbId}`
      };
    }

    if (!doc.isActive) {
      return {
        valid: false,
        errorCode: "INACTIVE_CARB_ID",
        errorMessage: `Carb ${carbId} is inactive or unavailable`
      };
    }

    const grams = Number(selection.grams);
    if (Number.isNaN(grams) || grams <= 0) {
      return {
        valid: false,
        errorCode: "INVALID_CARB_GRAMS",
        errorMessage: "Grams must be a number greater than 0"
      };
    }

    totalGrams += grams;
    processedSelections.push({ carbId: doc._id || carbId, grams });
  }

  if (totalGrams > maxTotalGrams) {
    return {
      valid: false,
      errorCode: "CARB_GRAMS_EXCEEDED",
      errorMessage: `Total carb grams (${totalGrams}g) exceeds maximum allowed (${maxTotalGrams}g)`
    };
  }

  return { valid: true, selections: processedSelections };
}

module.exports = {
  validateCarbSelections
};
