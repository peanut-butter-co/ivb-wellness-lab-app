import { describe, it, expect } from "vitest";
import { run } from "./run";

/**
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

describe("cart transform function", () => {
	// Test case 1: Empty input returns no operations (sin cambios)
	it("returns no operations for empty input", () => {
		const result = run({});
		const expected = /** @type {FunctionRunResult} */ ({ operations: [] });
		expect(result).toEqual(expected);
	});

	// Test case 2: Tax exemption enabled, no bundles (sin cambios)
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

	// Test case 3: No tax exemption, with bundles (sin cambios)
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
		expect(finalBundlePrice).toBeCloseTo(childCost, 2);
	});

	// Test case 4: Tax exemption enabled, with bundles (ajustado)
	it("merges bundle items AND applies tax exemption", () => {
		const parentCost = 99;
		const childCost = 55;
		const bundleTotalWithTaxes = parentCost + childCost; // 154
		const taxRate = 0.1; // 10%

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
								tax_percentage: { value: "10" },
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
								tax_percentage: { value: "18" }, // No se aplica
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

		// Debería tener 2 operaciones: 1 merge y 1 exención fiscal
		expect(result.operations.length).toBe(2);

		// Verificar operación de merge
		const mergeOp = result.operations.find((op) => op.merge);
		expect(mergeOp).toBeDefined();

		// Calcular el porcentaje esperado: parentCost/total, pero ajustado por el IVA
		const expectedPercentageDecrease =
			100 * (parentCost / bundleTotalWithTaxes / (1 + taxRate));
		expect(mergeOp.merge.price.percentageDecrease.value).toBeCloseTo(
			expectedPercentageDecrease,
			2
		);

		// El precio final debería ser: precio total - (precio padre con IVA - precio padre sin IVA)
		const parentWithoutTax = parentCost / (1 + taxRate);
		const taxAmount = parentCost - parentWithoutTax;
		const expectedFinalPrice = bundleTotalWithTaxes - taxAmount;

		// Calcular el precio final aplicando el porcentaje de descuento
		const finalBundlePrice =
			bundleTotalWithTaxes *
			(1 - mergeOp.merge.price.percentageDecrease.value / 100);
		expect(finalBundlePrice).toBeCloseTo(expectedFinalPrice, 2);

		// Verificar exención fiscal en elemento independiente
		const taxOp = result.operations.find((op) => op.update);
		expect(taxOp).toBeDefined();
		expect(taxOp.update.cartLineId).toBe("standalone1");
		expect(taxOp.update.price.adjustment.fixedPricePerUnit.amount).toBe(
			100
		);
	});

	// Test case 5: Invalid bundle configuration (sin cambios)
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

		// No debería haber operaciones
		expect(result.operations.length).toBe(0);
	});

	// Test case 6: Tax exemption enabled, with bundles (ajustado)
	it("handles test product bundle with tax exemption", () => {
		const parentCost = 80;
		const childCost1 = 10;
		const childCost2 = 10;
		const bundleTotalWithTaxes = parentCost + childCost1 + childCost2; // 100
		const taxRate = 0.1; // 10%

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
								tax_percentage: { value: "10" },
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
								tax_percentage: { value: "18" }, // No se aplica
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
								tax_percentage: { value: "18" }, // No se aplica
							},
						},
					},
				],
			},
		});

		// Debería tener 1 operación de merge
		expect(result.operations.length).toBe(1);

		// Verificar operación de merge
		const mergeOp = result.operations.find((op) => op.merge);
		expect(mergeOp).toBeDefined();

		// El porcentaje de descuento debería ser: (precio padre / precio total) / (1 + tasa IVA)
		const expectedPercentageDecrease =
			100 * (parentCost / bundleTotalWithTaxes / (1 + taxRate));
		expect(mergeOp.merge.price.percentageDecrease.value).toBeCloseTo(
			expectedPercentageDecrease,
			2
		);

		// El precio final debería ser: precio total - IVA del parent
		const parentWithoutTax = parentCost / (1 + taxRate);
		const taxAmount = parentCost - parentWithoutTax;
		const expectedFinalPrice = bundleTotalWithTaxes - taxAmount;

		// Calcular el precio final con el porcentaje de descuento aplicado
		const finalBundlePrice =
			bundleTotalWithTaxes *
			(1 - mergeOp.merge.price.percentageDecrease.value / 100);
		expect(finalBundlePrice).toBeCloseTo(expectedFinalPrice, 2);
		// El precio esperado es aproximadamente 90.91 (100 / 1.1)
		expect(finalBundlePrice).toBeCloseTo(90.91, 2);
	});

	// Test case 7: Real cart data with bundles (sin cambios)
	it("handles real cart data with three bundle items (no tax exemption)", () => {
		const result = run({
			presentmentCurrencyRate: "1.0",
			cart: {
				province_vat_exempt: {
					key: "province_vat_exempt",
					value: "false",
				},
				lines: [
					{
						id: "gid://shopify/CartLine/559db84f-53c3-449f-94a4-c093f133f061",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "10.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "child",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/55198548296057",
							title: null,
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
					{
						id: "gid://shopify/CartLine/29ca3092-9df6-4a48-a587-fa0fcccbb984",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "10.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "child",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/55198547640697",
							title: null,
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
					{
						id: "gid://shopify/CartLine/6e7c3915-b59a-4da1-9535-c3d2486712b1",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "80.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "parent",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/44079102099606",
							title: "Fresa / Pequeño",
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
				],
			},
		});

		// Calcular valores esperados
		const parentCost = 80.0;
		const childCost1 = 10.0;
		const childCost2 = 10.0;
		const totalCost = parentCost + childCost1 + childCost2;
		const expectedPercentageDecrease = 100 * (parentCost / totalCost);

		// Verificar que tenemos una operación de merge
		expect(result.operations.length).toBe(1);
		expect(result.operations[0].merge).toBeDefined();

		// Verificar el ID del variant padre
		expect(result.operations[0].merge.parentVariantId).toBe(
			"gid://shopify/ProductVariant/44079102099606"
		);

		// Verificar que los tres items están incluidos
		expect(result.operations[0].merge.cartLines.length).toBe(3);

		// Verificar IDs de líneas
		const cartLineIds = result.operations[0].merge.cartLines.map(
			(line) => line.cartLineId
		);
		expect(cartLineIds).toContain(
			"gid://shopify/CartLine/6e7c3915-b59a-4da1-9535-c3d2486712b1"
		); // parent
		expect(cartLineIds).toContain(
			"gid://shopify/CartLine/559db84f-53c3-449f-94a4-c093f133f061"
		); // child1
		expect(cartLineIds).toContain(
			"gid://shopify/CartLine/29ca3092-9df6-4a48-a587-fa0fcccbb984"
		); // child2

		// Verificar porcentaje de descuento (80%)
		expect(
			result.operations[0].merge.price.percentageDecrease.value
		).toBeCloseTo(expectedPercentageDecrease, 5);

		// Calcular el precio final
		const finalBundlePrice =
			totalCost * (1 - expectedPercentageDecrease / 100);

		// El precio final debe ser la suma de los costos de los hijos (20.0)
		expect(finalBundlePrice).toBeCloseTo(childCost1 + childCost2, 2);
	});

	// Test case 8: Real cart data with tax exemption (nuevo)
	it("handles real cart data with three bundle items AND tax exemption", () => {
		const result = run({
			presentmentCurrencyRate: "1.0",
			cart: {
				province_vat_exempt: {
					key: "province_vat_exempt",
					value: "true", // Con exención fiscal
				},
				lines: [
					{
						id: "gid://shopify/CartLine/559db84f-53c3-449f-94a4-c093f133f061",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "10.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "child",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/55198548296057",
							title: null,
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
					{
						id: "gid://shopify/CartLine/29ca3092-9df6-4a48-a587-fa0fcccbb984",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "10.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "child",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/55198547640697",
							title: null,
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
					{
						id: "gid://shopify/CartLine/6e7c3915-b59a-4da1-9535-c3d2486712b1",
						quantity: 1,
						cost: {
							totalAmount: {
								amount: "80.0",
								currencyCode: "EUR",
							},
						},
						pack_id: {
							value: "1747060864476",
						},
						pack_type: {
							value: "parent",
						},
						merchandise: {
							__typename: "ProductVariant",
							id: "gid://shopify/ProductVariant/44079102099606",
							title: "Fresa / Pequeño",
							product: {
								tax_percentage: {
									value: "10.0",
								},
							},
						},
					},
				],
			},
		});

		// Calcular valores esperados
		const parentCost = 80.0;
		const childCost1 = 10.0;
		const childCost2 = 10.0;
		const totalCost = parentCost + childCost1 + childCost2; // 100
		const taxRate = 0.1;

		// El porcentaje de descuento debería ser: (precio padre / precio total) / (1 + tasa IVA)
		const expectedPercentageDecrease =
			100 * (parentCost / totalCost / (1 + taxRate));

		// Verificar que tenemos una operación de merge
		expect(result.operations.length).toBe(1);
		expect(result.operations[0].merge).toBeDefined();

		// Verificar el porcentaje de descuento
		expect(
			result.operations[0].merge.price.percentageDecrease.value
		).toBeCloseTo(expectedPercentageDecrease, 2);

		// El precio final debería ser: precio total - IVA del parent
		const parentWithoutTax = parentCost / (1 + taxRate);
		const taxAmount = parentCost - parentWithoutTax;
		const expectedFinalPrice = totalCost - taxAmount;

		// Calcular el precio final con el porcentaje de descuento aplicado
		const finalBundlePrice =
			totalCost *
			(1 -
				result.operations[0].merge.price.percentageDecrease.value /
					100);

		// El precio final debe ser 90.91 (100/1.1)
		expect(finalBundlePrice).toBeCloseTo(expectedFinalPrice, 2);
		expect(finalBundlePrice).toBeCloseTo(90.91, 2);
	});
});
