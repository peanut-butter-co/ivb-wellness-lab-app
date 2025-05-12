// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 * @typedef {import("../generated/api").CartOperation} CartOperation
 * @typedef {import("../generated/api").MergeOperation} MergeOperation
 * @typedef {import("../generated/api").CartLineFields} CartLineFields
 */

/**
 * @type {FunctionRunResult}
 */
const NO_CHANGES = {
	operations: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
    
    if (!input?.cart?.lines) {
        return NO_CHANGES;
    }

	const performTaxExemption =
		input?.cart?.province_vat_exempt?.value === "true";

	let operations = [];
	const bundles = {};
	const bundledLineIds = new Set();
	let hasPackItems = false;

	// Single-pass cart iteration
	for (const line of input.cart.lines) {
		const packId = line.pack_id?.value;

		if (packId) {
			// Track that we have at least one pack item
			hasPackItems = true;

			// Group into bundles
			if (!bundles[packId]) {
				bundles[packId] = [];
			}
			bundles[packId].push(line);
			bundledLineIds.add(line.id);
		}
	}

	if (!hasPackItems && !performTaxExemption) {
		return NO_CHANGES;
	}

	// Process bundles
	for (const packId in bundles) {
		const bundleLines = bundles[packId];
		const mergeOp = mergeBundles(bundleLines, performTaxExemption);
		if (mergeOp) {
			operations.push({ merge: mergeOp });
		}
	}

	// Only apply tax exemption if needed and only to non-bundled lines
	if (performTaxExemption) {
		for (const line of input.cart.lines) {
			if (!bundledLineIds.has(line.id)) {
				applyTaxExemptionToLine(line, operations);
			}
		}
	}

	return operations.length > 0 ? { operations } : NO_CHANGES;
}

/**
 * @param {CartLineFields} line
 * @param {CartOperation[]} operations
 */
function applyTaxExemptionToLine(line, operations) {
	let taxDivider = 1.21;

	if (line.merchandise.__typename === "ProductVariant") {
		const productTaxPercentage = line.merchandise.product.tax_percentage;
		if (productTaxPercentage?.value) {
			const taxPercentageNumber = parseFloat(productTaxPercentage.value);
			if (!isNaN(taxPercentageNumber) && taxPercentageNumber <= 100) {
				taxDivider = 1 + taxPercentageNumber / 100;
			}
		}
	}

	operations.push({
		update: {
			cartLineId: line.id,
			price: {
				adjustment: {
					fixedPricePerUnit: {
						amount:
							line.cost.totalAmount.amount /
							line.quantity /
							taxDivider,
					},
				},
			},
		},
	});
}

/**
 * @param {CartLineFields[]} bundle
 * @param {boolean} performTaxExemption
 * @returns {MergeOperation|null}
 */
function mergeBundles(bundle, performTaxExemption) {
	let parent;
	const childLines = [];

	// Separate parent and child lines
	for (const line of bundle) {
		const packType = line.pack_type?.value?.toLowerCase() || "";
		if (packType === "parent") {
			parent = line;
		} else if (packType === "child") {
			childLines.push(line);
		}
	}

	// Basic checks
	if (!parent || parent.merchandise.__typename !== "ProductVariant") {
		return null;
	}

	const parentCost = parseFloat(parent.cost.totalAmount.amount || "0");
	let packTotal = parentCost;

	for (const line of childLines) {
		const linePrice = parseFloat(line.cost.totalAmount.amount || "0");
		packTotal += linePrice;
	}

	// Price adjustment so the parent line effectively becomes the full price
	let priceAdjustment = 100;
	if (packTotal > 0) {
		priceAdjustment = 100 * (parentCost / packTotal);
	}

	// Now apply the tax exemption if needed
	if (performTaxExemption) {
		const taxPercentage = parent.merchandise.product.tax_percentage?.value;
		if (taxPercentage) {
			priceAdjustment =
				priceAdjustment * (1 + (parseFloat(taxPercentage) / 100));
		}
	}

    const attributes = [];

	const mergeOperation = {
		cartLines: [
			{
				cartLineId: parent.id,
				quantity: 1,
			},
			...childLines.map((child) => ({
				cartLineId: child.id,
				quantity: 1,
			})),
		],
		parentVariantId: parent.merchandise.id,
		price: {
			percentageDecrease: {
				value: priceAdjustment,
			},
		},
		attributes,
	};

	return mergeOperation;
}
