import frappe
import json
from frappe.utils import flt, get_datetime
from frappe import _
from frappe.utils.caching import redis_cache
from posawesome.posawesome.api.utils import _ensure_pos_profile

@frappe.whitelist()
def is_healthcare_installed():
    return "healthcare" in frappe.get_installed_apps()

@frappe.whitelist()
def get_patient_medications(patient, pos_profile, encounter=None):
    """
    Fetch submitted unpaid Medication Requests for a given patient.
    Uses ERPNext get_item_details to fetch stock, taxes, rules,
    but prioritizes the explicit rate set in the Medication child table.
    """
    if not patient:
        return []

    profile_dict, _ = _ensure_pos_profile(pos_profile)
    
    filters = {
        "patient": patient,
        "docstatus": 1,
        "status": ["not in", ["completed-Medication Request Status", "cancelled-Medication Request Status", "stopped-Medication Request Status", "entered-in-error-Medication Request Status"]],
        "billing_status": ["!=", "Invoiced"]
    }

    if encounter:
        filters["order_group"] = encounter

    # 1. Fetch Medication Requests for this patient that are submitted and not fully invoiced
    requests = frappe.get_all(
        "Medication Request",
        filters=filters,
        fields=[
            "name",
            "medication",
            "medication_item",
            "quantity",
            "qty_invoiced",
            "dosage",
            "period"
        ]
    )

    if not requests:
        return []

    # Prepare raw item rows
    item_rows = []
    medication_names = []
    for req in requests:
        qty_to_bill = flt(req.quantity) - flt(req.qty_invoiced)
        if qty_to_bill <= 0:
            continue
            
        if req.medication:
            medication_names.append(req.medication)
            
        row = {
            "item_code": req.medication_item,
            "medication": req.medication,
            "qty": qty_to_bill,
            "dosage": req.dosage,
            "period": req.period,
            "reference_dt": "Medication Request",
            "reference_dn": req.name
        }
        item_rows.append(row)

    if not item_rows:
        return []

    # 2. Pre-fetch Medication Linked Item rates
    medication_rates = {}
    if medication_names:
        linked_items = frappe.get_all(
            "Medication Linked Item",
            filters={"parent": ["in", list(set(medication_names))]},
            fields=["parent", "item_code", "rate"]
        )
        for li in linked_items:
            medication_rates[(li.parent, li.item_code)] = flt(li.rate)

    # 3. Use ERPNext's get_item_details to fetch the correct prices and taxes
    from erpnext.stock.get_item_details import get_item_details
    customer = frappe.db.get_value("Patient", patient, "customer")
    company = profile_dict.get("company")
    warehouse = profile_dict.get("warehouse")
    price_list = profile_dict.get("selling_price_list")
    currency = profile_dict.get("currency")

    # Create a dummy Sales Invoice doc dict so pricing rules and taxes evaluate correctly
    doc = frappe._dict({
        "doctype": "Sales Invoice",
        "company": company,
        "customer": customer,
        "currency": currency,
        "price_list_currency": currency,
        "conversion_rate": 1.0,
        "plc_conversion_rate": 1.0,
        "selling_price_list": price_list,
        "is_pos": 1
    })

    from posawesome.posawesome.api.item_fetchers import ItemDetailAggregator

    aggregator = ItemDetailAggregator(profile_dict, price_list=price_list, customer=customer)
    # Prepare items for aggregator
    agg_items = [{"item_code": r["item_code"]} for r in item_rows]
    enrichment_map = {d["item_code"]: d for d in aggregator.build_details(agg_items)}

    final_cart_items = []
    
    for row in item_rows:
        item_code = row.get("item_code")
        qty = flt(row.get("qty"))
        medication = row.get("medication")
        
        try:
            # Get enriched details (batches, uoms, etc.)
            item_details = enrichment_map.get(item_code)
            
            if not item_details:
                # Fallback (old logic simplified)
                med_name = medication or item_code
                dosage_str = row.get("dosage")
                period_str = row.get("period")
                desc = f"{dosage_str} for {period_str}" if (dosage_str and period_str) else (dosage_str or f"(Medication Request: {row.get('reference_dn')})")
                
                cart_item = {
                    "item_code": item_code,
                    "qty": qty,
                    "rate": 0,
                    "amount": 0,
                    "description": desc,
                    "reference_dt": "Medication Request",
                    "reference_dn": row.get("reference_dn"),
                    "posa_row_id": frappe.generate_hash(length=12),
                    "has_batch_no": 0,
                    "batch_no_data": []
                }
                final_cart_items.append(cart_item)
                continue

            # Check if there is an explicit rate in the Medication Linked Item table
            explicit_rate = None
            if medication:
                explicit_rate = medication_rates.get((medication, item_code))
                
            if explicit_rate is not None and explicit_rate > 0:
                rate = explicit_rate
            else:
                rate = (
                    flt(item_details.get("price_list_rate")) or 
                    flt(item_details.get("base_price_list_rate")) or
                    flt(item_details.get("rate", 0))
                )

            if not rate and price_list:
                pl_rate = frappe.db.get_value(
                    "Item Price",
                    {"item_code": item_code, "price_list": price_list, "selling": 1},
                    "price_list_rate"
                )
                if pl_rate:
                    rate = flt(pl_rate)
            
            dosage_str = row.get("dosage")
            period_str = row.get("period")

            if dosage_str and period_str:
                desc = f"{dosage_str} for {period_str}"
            elif dosage_str:
                desc = f"{dosage_str}"
            elif period_str:
                desc = f"for {period_str}"
            else:
                desc = item_details.get("description") or f"(Medication Request: {row.get('reference_dn')})"

            cart_item = {
                "item_code": item_code,
                "item_name": item_details.get("item_name"),
                "description": desc,
                "qty": qty,
                "uom": item_details.get("uom") or item_details.get("stock_uom"),
                "stock_uom": item_details.get("stock_uom"),
                "conversion_factor": item_details.get("conversion_factor", 1.0),
                "rate": rate,
                "price_list_rate": rate,
                "original_rate": rate,
                "base_rate": rate,
                "base_price_list_rate": rate,
                "amount": qty * rate,
                "actual_qty": item_details.get("actual_qty", 0),
                "has_batch_no": item_details.get("has_batch_no", 0),
                "has_serial_no": item_details.get("has_serial_no", 0),
                "is_stock_item": item_details.get("is_stock_item", 0),
                "allow_negative_stock": item_details.get("allow_negative_stock", 0),

                # POS Awesome expects item_uoms to be at least a list
                "item_uoms": item_details.get("item_uoms") or [{"uom": item_details.get("uom"), "conversion_factor": 1}],
                "batch_no_data": item_details.get("batch_no_data") or [],
                "serial_no_data": item_details.get("serial_no_data") or [],
                
                # Reference
                "reference_dt": "Medication Request",
                "reference_dn": row.get("reference_dn"),
                "posa_row_id": frappe.generate_hash(length=12),
                
                # Taxes and other pricing rule fields
                "item_tax_template": item_details.get("item_tax_template"),
                "discount_percentage": item_details.get("discount_percentage", 0),
            }
            final_cart_items.append(cart_item)

        except Exception as e:
            frappe.log_error(f"Error fetching item details for {item_code}: {e}", "Medication Fetch Error")
            # Fallback to explicit or price list rate
            fallback_rate = 0
            if medication:
                explicit_rate = medication_rates.get((medication, item_code))
                if explicit_rate:
                    fallback_rate = explicit_rate

            if not fallback_rate and price_list:
                pl_rate = frappe.db.get_value(
                    "Item Price",
                    {"item_code": item_code, "price_list": price_list, "selling": 1},
                    "price_list_rate"
                )
                if pl_rate:
                    fallback_rate = flt(pl_rate)

            dosage_str = row.get("dosage")
            period_str = row.get("period")

            if dosage_str and period_str:
                fallback_desc = f"{dosage_str} for {period_str}"
            elif dosage_str:
                fallback_desc = f"{dosage_str}"
            else:
                fallback_desc = f"(Medication Request: {row.get('reference_dn')})"

            cart_item = {
                "item_code": item_code,
                "qty": qty,
                "rate": fallback_rate,
                "price_list_rate": fallback_rate,
                "amount": qty * fallback_rate,
                "description": fallback_desc,
                "reference_dt": "Medication Request",
                "reference_dn": row.get("reference_dn"),
                "posa_row_id": frappe.generate_hash(length=12)
            }
            final_cart_items.append(cart_item)

    return final_cart_items


@frappe.whitelist()
def search_patients(search_term=""):
    meta = frappe.get_meta("Patient")
    search_fields = meta.search_fields.split(",") if meta.search_fields else []
    
    or_filters = {
        "name": ["like", f"%{search_term}%"]
    }
    for field in search_fields:
        field = field.strip()
        or_filters[field] = ["like", f"%{search_term}%"]
        
    return frappe.get_all(
        "Patient",
        filters={"status": ["!=", "Disabled"]},
        or_filters=or_filters,
        fields=["name", "patient_name", "mobile", "customer"],
        limit_page_length=20
    )


@frappe.whitelist()
def get_patient_names(pos_profile, limit=None, offset=None, start_after=None, modified_after=None):
    _pos_profile = json.loads(pos_profile)
    ttl = _pos_profile.get("posa_server_cache_duration")
    if ttl:
        ttl = int(ttl) * 60

    @redis_cache(ttl=ttl or 1800)
    def __get_patient_names(pos_profile, limit=None, offset=None, start_after=None, modified_after=None):
        return _get_patient_names(pos_profile, limit, offset, start_after, modified_after)

    def _get_patient_names(pos_profile, limit=None, offset=None, start_after=None, modified_after=None):
        filters = {"status": ["!=", "Disabled"]}

        if modified_after:
            try:
                parsed_modified_after = get_datetime(modified_after)
            except Exception:
                frappe.throw(_("modified_after must be a valid ISO datetime"))
            filters["modified"] = [">", parsed_modified_after.isoformat()]

        if start_after:
            filters["name"] = [">", start_after]

        patients = frappe.get_all(
            "Patient",
            filters=filters,
            fields=["name", "patient_name", "mobile", "customer"],
            order_by="name",
            limit_start=None if start_after else offset,
            limit_page_length=limit,
        )
        return patients

    if _pos_profile.get("posa_use_server_cache") and not (limit or offset or start_after or modified_after):
        return __get_patient_names(pos_profile, limit, offset, start_after, modified_after)
    else:
        return _get_patient_names(pos_profile, limit, offset, start_after, modified_after)


@frappe.whitelist()
def get_pending_medication_encounters(patient):
    """
    Fetch Patient Encounters that have at least one submitted Medication Request 
    that is not yet fully invoiced.
    """
    if not patient:
        return []

    # Find unique order_groups from Medication Request with pending billing
    encounters = frappe.db.sql("""
        SELECT DISTINCT
            pe.name,
            pe.encounter_date,
            pe.practitioner_name,
            pe.creation
        FROM `tabPatient Encounter` pe
        JOIN `tabMedication Request` mr ON mr.order_group = pe.name
        WHERE
            pe.patient = %s
            AND pe.docstatus = 1
            AND mr.docstatus = 1
            AND mr.billing_status != 'Invoiced'
            AND mr.status NOT IN ('completed-Medication Request Status', 'cancelled-Medication Request Status', 'stopped-Medication Request Status', 'entered-in-error-Medication Request Status')
        ORDER BY pe.creation DESC
    """, (patient,), as_dict=True)

    return encounters


@frappe.whitelist()
def get_patients_count(pos_profile):
    filters = {"status": ["!=", "Disabled"]}
    return frappe.db.count("Patient", filters)
