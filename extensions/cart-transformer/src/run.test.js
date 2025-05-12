import { describe, it, expect } from "vitest";
import { run } from "./run";

/**
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

describe("cart transform function", () => {
	// Test case 1: Empty input returns no operations
	it("returns no operations for empty input", () => {
		const result = run({});
		const expected = /** @type {FunctionRunResult} */ ({ operations: [] });
		expect(result).toEqual(expected);
	});

	// Test case 2: Tax exemption enabled, no bundles
	it("applies tax exemption to items when province_vat_exempt is true", () => {
		const result = run({
			cart: {
				province_vat_exempt: { value: "true" },
				lines: [
					{
						id: "line1",
						quantity: 1,
						cost: { totalAmount: { amount: "121" } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "21" },
							},
						},
					},
				],
			},
		});

		// Check that we have one tax exemption operation
		expect(result.operations.length).toBe(1);
		expect(result.operations[0].update).toBeDefined();
		expect(result.operations[0].update.cartLineId).toBe("line1");

		// Check final price after tax exemption
		const finalPricePerUnit =
			result.operations[0].update.price.adjustment.fixedPricePerUnit
				.amount;
		expect(finalPricePerUnit).toBe(100);

		// Validate calculation: 121 / (1 + 0.21) = 100
		const originalPrice = 121;
		const taxRate = 0.21;
		const expectedPriceWithoutTax = originalPrice / (1 + taxRate);
		expect(finalPricePerUnit).toBe(expectedPriceWithoutTax);
	});

	// Test case 3: No tax exemption, with bundles
	it("merges bundle items without tax exemption", () => {
		const parentCost = 1;
		const childCost = 50;
		const bundleTotal = parentCost + childCost;

		const result = run({
			cart: {
				province_vat_exempt: { value: "false" },
				lines: [
					{
						id: "parent1",
						quantity: 2,
						pack_id: { value: "bundle1" },
						pack_type: { value: "parent" },
						cost: { totalAmount: { amount: String(parentCost) } },
						merchandise: {
							__typename: "ProductVariant",
							id: "parentvariant1",
							product: {},
						},
					},
					{
						id: "child1",
						quantity: 3,
						pack_id: { value: "bundle1" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: String(childCost) } },
						merchandise: {
							__typename: "ProductVariant",
							product: {},
						},
					},
				],
			},
		});

		// Check that we have one merge operation
		expect(result.operations.length).toBe(1);
		expect(result.operations[0].merge).toBeDefined();
		expect(result.operations[0].merge.parentVariantId).toBe(
			"parentvariant1"
		);
		expect(result.operations[0].merge.cartLines.length).toBe(2);

		// Check percentage decrease
		const percentageDecrease =
			result.operations[0].merge.price.percentageDecrease.value;
		expect(percentageDecrease).toBe(100 * (parentCost / bundleTotal));

		// Calculate final bundle price
		const finalBundlePrice = bundleTotal * (1 - percentageDecrease / 100);

		// The final price should be approximately equal to the child cost only
		// Since the parent cost is being effectively subtracted
		expect(finalBundlePrice).toBeCloseTo(childCost, 2);

		// Alternatively, assert that the final price is what we expect
		const expectedFinalPrice = childCost;
		expect(finalBundlePrice).toBeCloseTo(expectedFinalPrice, 2);
	});

	// Test case 4: Tax exemption enabled, with bundles
	it("merges bundle items AND applies tax exemption", () => {
		const parentCost = 99;
		const childCost = 55;
        const parentTaxRate = 10;
		const bundleTotalWithTaxes = 154;
        const bundleTotalWithoutTaxes = 140;     

		const result = run({
			cart: {
				province_vat_exempt: { value: "true" },
				lines: [
					{
						id: "parent1",
						quantity: 2,
						pack_id: { value: "bundle1" },
						pack_type: { value: "parent" },
						cost: { totalAmount: { amount: String(parentCost) } },
						merchandise: {
							__typename: "ProductVariant",
							id: "parentvariant1",
							product: {
								tax_percentage: { value: "10" }, //Se debe aplicar esta a productos hijos también
							},
						},
					},
					{
						id: "child1",
						quantity: 3,
						pack_id: { value: "bundle1" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: String(childCost) } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "18" }, // Este no se aplica
							},
						},
					},
					{
						id: "standalone1",
						quantity: 1,
						cost: { totalAmount: { amount: "121" } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "21" }, // Este no se aplica
							},
						},
					},
				],
			},
		});

		// Should have 2 operations: 1 merge and 1 tax exemption
		expect(result.operations.length).toBe(2);

		// Check merge operation
		const mergeOp = result.operations.find((op) => op.merge);
		expect(mergeOp).toBeDefined();

		// Check the percentage decrease value
		const expectedPercentageDecrease =
			100 * (parentCost / bundleTotalWithTaxes * (1 + (parentTaxRate/100)));
		expect(mergeOp.merge.price.percentageDecrease.value).toBeCloseTo(expectedPercentageDecrease, 5);

		// Check tax exemption on non-bundled item
		const taxOp = result.operations.find((op) => op.update);
		expect(taxOp).toBeDefined();
		expect(taxOp.update.cartLineId).toBe("standalone1");
		expect(taxOp.update.price.adjustment.fixedPricePerUnit.amount).toBe(
			100
		);
	});

	// Test case 5: Invalid bundle configuration
	it("ignores invalid bundles (no parent)", () => {
		const result = run({
			cart: {
				province_vat_exempt: { value: "false" },
				lines: [
					{
						id: "child1",
						quantity: 1,
						pack_id: { value: "bundle1" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: "50" } },
						merchandise: {
							__typename: "ProductVariant",
							product: {},
						},
					},
					{
						id: "child2",
						quantity: 1,
						pack_id: { value: "bundle1" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: "50" } },
						merchandise: {
							__typename: "ProductVariant",
							product: {},
						},
					},
				],
			},
		});

		// Should have no operations
		expect(result.operations.length).toBe(0);
	});

    // Test case 6: Tax exemption enabled, with bundles. Equal to test product
	it("merges bundle items AND applies tax exemption", () => {
		const parentCost = 80;
		const childCost1 = 10;
        const childCost2 = 10;
        const parentTaxRate = 10;
		const bundleTotalWithTaxes = 100;

		const result = run({
			cart: {
				province_vat_exempt: { value: "true" },
				lines: [
					{
						id: "parent1",
						quantity: 2,
						pack_id: { value: "12345978" },
						pack_type: { value: "parent" },
						cost: { totalAmount: { amount: String(parentCost) } },
						merchandise: {
							__typename: "ProductVariant",
							id: "parentvariant1",
							product: {
								tax_percentage: { value: "10" }, //Se debe aplicar esta a productos hijos también
							},
						},
					},
					{
						id: "child1",
						quantity: 3,
						pack_id: { value: "12345978" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: String(childCost1) } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "18" }, // Este no se aplica
							},
						},
					},
					{
						id: "child2",
						quantity: 3,
						pack_id: { value: "12345978" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: String(childCost2) } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "18" }, // Este no se aplica
							},
						},
					},
				],
			},
		});

		// Should have 2 operations: 1 merge and 1 tax exemption
		expect(result.operations.length).toBe(1);

		// Check merge operation
		const mergeOp = result.operations.find((op) => op.merge);
		expect(mergeOp).toBeDefined();

		// Check the percentage decrease value
		const expectedPercentageDecrease =
			100 * (parentCost / bundleTotalWithTaxes * (1 + (parentTaxRate/100)));
		expect(mergeOp.merge.price.percentageDecrease.value).toBeCloseTo(expectedPercentageDecrease, 5);
	});
});
