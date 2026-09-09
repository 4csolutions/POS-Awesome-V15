import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	getTaxTemplate: vi.fn(() => null),
	getTaxInclusiveSetting: vi.fn(() => false),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_getPlcConversionRate: vi.fn(() => 1),
}));

import { get_invoice_doc, get_invoice_items } from "../src/posapp/components/pos/invoice_utils/document";

describe("get_invoice_doc", () => {
	beforeEach(() => {
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const number = Number(value || 0);
			return Number(number.toFixed(precision));
		};
	});

	it("updates customer title when draft customer changes", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-NEW",
				customer_name: "New Customer",
			},
			customer: "CUST-NEW",
			isReturnInvoice: false,
			items: [],
			packed_items: [],
			Total: 0,
			subtotal: 0,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "SINV-DRAFT",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("New Customer");
	});

	it("clears stale party details when customer changes on a reused source doc", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-NEW",
				customer_name: "New Customer",
			},
			customer: "CUST-NEW",
			isReturnInvoice: false,
			items: [],
			packed_items: [],
			Total: 0,
			subtotal: 0,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "ACC-SINV-0001",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address_name: "SHIP-OLD",
				contact_person: "CONT-OLD",
				address_display: "Old Address",
				contact_display: "Old Contact",
				contact_mobile: "0300",
				contact_email: "old@example.com",
				territory: "Old Territory",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("New Customer");
		expect(doc.customer_address).toBeNull();
		expect(doc.shipping_address_name).toBeNull();
		expect(doc.contact_person).toBeNull();
		expect(doc.address_display).toBeNull();
		expect(doc.contact_display).toBeNull();
		expect(doc.contact_mobile).toBeNull();
		expect(doc.contact_email).toBeNull();
		expect(doc.territory).toBeNull();
	});

	it("ignores mismatched cached customer info when resolving a different customer", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address: "SHIP-OLD",
				contact_person: "CONT-OLD",
				territory: "Old Territory",
			},
			customer: "CUST-NEW",
			isReturnInvoice: false,
			items: [],
			packed_items: [],
			Total: 0,
			subtotal: 0,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "ACC-SINV-0002",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address_name: "SHIP-OLD",
				contact_person: "CONT-OLD",
				territory: "Old Territory",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("CUST-NEW");
		expect(doc.customer_address).toBeNull();
		expect(doc.shipping_address_name).toBeNull();
		expect(doc.contact_person).toBeNull();
		expect(doc.territory).toBeNull();
	});

	it("marks backdated invoices to preserve the selected posting date on submit", () => {
		(globalThis as any).frappe = {
			datetime: {
				nowdate: () => "2026-03-28",
			},
		};

		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-001",
				customer_name: "Walk-in Customer",
			},
			customer: "CUST-001",
			isReturnInvoice: false,
			items: [],
			packed_items: [],
			Total: 0,
			subtotal: 0,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-03-20",
			posting_date: "2026-03-20",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.posting_date).toBe("2026-03-20");
		expect(doc.set_posting_time).toBe(1);
	});

	it("populates warehouse and default profile accounts on invoice and items", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "INR",
				warehouse: "Stores - TC",
				cost_center: "Main - TC",
				income_account: "Sales - TC",
				expense_account: "Cost of Goods Sold - TC",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "INR",
			conversion_rate: 1,
			company: { default_currency: "INR" },
			price_list_currency: "INR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-001",
				customer_name: "Walk-in Customer",
			},
			customer: "CUST-001",
			isReturnInvoice: false,
			items: [
				{
					item_code: "3WAY COCK",
					item_name: "3WAY COCK",
					qty: 2,
					rate: 50,
					price_list_rate: 50,
					uom: "Nos",
					is_stock_item: 1,
				},
				{
					item_code: "5D IV 500ML",
					item_name: "5D IV 500ML",
					warehouse: "Pharmacy - TC",
					qty: 1,
					rate: 91.59,
					price_list_rate: 91.59,
					uom: "Bottle",
					is_stock_item: 1,
				},
			],
			packed_items: [],
			Total: 191.59,
			subtotal: 191.59,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-09-09",
			posting_date: "2026-09-09",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.set_warehouse).toBe("Stores - TC");
		expect(doc.cost_center).toBe("Main - TC");
		expect(doc.items).toHaveLength(2);

		// Items in reverse order as per get_invoice_items convention
		const itemWithCustomWarehouse = doc.items.find((it: any) => it.item_code === "5D IV 500ML");
		const itemWithDefaultWarehouse = doc.items.find((it: any) => it.item_code === "3WAY COCK");

		expect(itemWithDefaultWarehouse.warehouse).toBe("Stores - TC");
		expect(itemWithDefaultWarehouse.cost_center).toBe("Main - TC");
		expect(itemWithDefaultWarehouse.income_account).toBe("Sales - TC");
		expect(itemWithDefaultWarehouse.expense_account).toBe("Cost of Goods Sold - TC");

		expect(itemWithCustomWarehouse.warehouse).toBe("Pharmacy - TC");
	});
});
