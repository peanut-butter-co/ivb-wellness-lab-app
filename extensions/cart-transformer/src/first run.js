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

// Cache for parsed pack configs (avoid repeated JSON.parse)
const packConfigCache = new Map();

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
	const performTaxExemption =
		input?.cart?.province_vat_exempt?.value === "true";

	const bundles = groupLineItemsInBundle(input.cart.lines);

	if (Object.keys(bundles).length === 0 && !performTaxExemption)
		return NO_CHANGES;

	let operations = [];

	// Track which lines are part of bundles to avoid double tax exemption
	const bundledLineIds = new Set();

	for (const packId in bundles) {
		const bundleLines = bundles[packId];

		// Track all bundled lines to avoid double-processing
		bundleLines.forEach((line) => bundledLineIds.add(line.id));

		const mergeOp = isValidBundle(input, bundleLines, performTaxExemption);

		if (mergeOp) {
			operations.push({ merge: mergeOp });
		}
	}

	// Only apply tax exemption if needed
	if (performTaxExemption) {
		// Apply tax exemptions ONLY to non-bundled lines
		input.cart.lines
			.filter((line) => !bundledLineIds.has(line.id))
			.forEach((line) => {
				let taxDivider = 1.21;

				if (line.merchandise.__typename === "ProductVariant") {
					const productTaxPercentage =
						line.merchandise.product.tax_percentage;
					if (productTaxPercentage?.value) {
						const taxPercentageNumber = parseFloat(
							productTaxPercentage.value
						);
						if (
							!isNaN(taxPercentageNumber) &&
							taxPercentageNumber <= 100
						) {
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
			});
	}

	return operations.length > 0 ? { operations } : NO_CHANGES;
}

/**
 * @param {RunInput} cart
 * @param {CartLineFields[]} bundle
 * @param {boolean} performTaxExemption
 * @returns {MergeOperation|null}
 */
function isValidBundle(cart, bundle, performTaxExemption) {
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

	//Now apply the taxexemption if needed
	if (performTaxExemption) {
		const taxPercentage = parent.merchandise.product.tax_percentage?.value;
		if (taxPercentage) {
			priceAdjustment =
				priceAdjustment * (1 - parseFloat(taxPercentage) / 100);
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

/**
 * @param {CartLineFields[]} lines
 */
function groupLineItemsInBundle(lines) {
	const bundles = {};

	for (const line of lines) {
		const packId = line.pack_id?.value;
		if (packId) {
			if (!bundles[packId]) {
				bundles[packId] = [];
			}
			bundles[packId].push(line);
		}
	}

	return bundles;
}
