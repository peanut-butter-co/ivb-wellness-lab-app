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
		expect(
			result.operations[0].update.price.adjustment.fixedPricePerUnit
				.amount
		).toBe(100);
	});

	// Test case 3: No tax exemption, with bundles
	it("merges bundle items without tax exemption", () => {
		const result = run({
			cart: {
				province_vat_exempt: { value: "false" },
				lines: [
					{
						id: "parent1",
						quantity: 2, //better different from 1 to test amount per unit properly
						pack_id: { value: "bundle1" },
						pack_type: { value: "parent" },
						cost: { totalAmount: { amount: "1" } },
						merchandise: {
							__typename: "ProductVariant",
							id: "parentvariant1",
							product: {},
						},
					},
					{
						id: "child1",
						quantity: 3, //better different from 1 to test amount per unit properly
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

		// Check that we have one merge operation
		expect(result.operations.length).toBe(1);
		expect(result.operations[0].merge).toBeDefined();
		expect(result.operations[0].merge.parentVariantId).toBe(
			"parentvariant1"
		);
		expect(result.operations[0].merge.cartLines.length).toBe(2);
		expect(result.operations[0].merge.price.percentageDecrease.value).toBe(
			// FROM run.js
			// const linePrice = parseFloat(line.cost.totalAmount.amount || "0");
			// packTotal = partenCost + linePrice;
			// percentageDecrease priceAdjustment = 100 * (parentCost / packTotal);
			100 * (1 / (50 + 1))
		);
	});

	// Test case 4: Tax exemption enabled, with bundles
	it("merges bundle items AND applies tax exemption", () => {
		const result = run({
			cart: {
				province_vat_exempt: { value: "true" },
				lines: [
					{
						id: "parent1",
						quantity: 2,
						pack_id: { value: "bundle1" },
						pack_type: { value: "parent" },
						cost: { totalAmount: { amount: "1" } },
						merchandise: {
							__typename: "ProductVariant",
							id: "parentvariant1",
							product: {
								tax_percentage: { value: "18" }, //This must be the tax exempted for bundle
							},
						},
					},
					{
						id: "child1",
						quantity: 3,
						pack_id: { value: "bundle1" },
						pack_type: { value: "child" },
						cost: { totalAmount: { amount: "118" } },
						merchandise: {
							__typename: "ProductVariant",
							product: {
								tax_percentage: { value: "10" }, //This must NOT be the tax exempted for bundle
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
								tax_percentage: { value: "21" },
							},
						},
					},
				],
			},
		});

		// Should have 2 operations: 1 merge and 1 tax exemption
		expect(result.operations.length).toBe(2);

		// Check merge operation (should have tax-adjusted price adjustment, tax of the parent exempted)
		const mergeOp = result.operations.find((op) => op.merge);
		expect(mergeOp).toBeDefined();
		expect(mergeOp.merge.price.percentageDecrease.value).toBe(
			// FROM run.js
			// const linePrice = parseFloat(line.cost.totalAmount.amount || "0");
			// packTotal = partenCost + linePrice;
			// percentageDecrease priceAdjustment = 100 * (parentCost / packTotal);
            // +Tax exemption: priceAdjustment = priceAdjustment * (1 - parseFloat(taxPercentage) / 100);
			100 * (1 / (118 + 1)) * (1 - (18) / 100)
		);
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
});
