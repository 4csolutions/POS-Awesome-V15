# Hospital Pharmacy POS System: Design Document for POSAwesome

## 1. Executive Summary
This document outlines the architectural and functional modifications required to adapt the POSAwesome application into a robust, compliant, and efficient Point of Sale (POS) system for hospital pharmacies. Building upon the existing integration of Patient selection and Encounter-to-Cart loading, these enhancements focus on patient safety, strict inventory controls (batch/expiry), insurance handling, and seamless workflow integration with the broader Hospital Information System (Frappe Healthcare).

## 2. Current State & Foundation
We are already leveraging the following capabilities:
- **Patient Linkage:** Ability to select a Patient directly within the POS UI.
- **Encounter Integration:** Loading prescribed medications directly from a Patient Encounter into the POS cart.
- **Offline Reliability:** POSAwesome's robust offline-first architecture.

**Goal:** Transform the base POS system into a specialized Pharmacy Dispensing Unit that handles the unique medical, financial, and regulatory constraints of a hospital environment.

---

## 3. Core Functional Requirements & Design Changes

### 3.1. Advanced Prescription Dispensing
- **Pending Prescription Queue:** Beyond direct encounters, the POS should have a "Prescription Queue" view allowing pharmacists to see all unfulfilled prescriptions for the day, filterable by Inpatient/Outpatient.
- **Prescriber Tracking & Authentication:** Accurately capture and link the prescribing Healthcare Practitioner from the encounter or prescription to the invoice for accountability.
- **Generic Substitution:** If a prescribed brand is unavailable, the UI must provide a one-click "Suggest Substitute" feature. This queries the backend for `Medication` records with the same Generic Composition that link to `Item` records with sufficient stock.
- **Partial Dispensing & Refills:** Support editing the loaded prescription quantities. If a patient only buys half the prescribed amount (e.g., 5 days out of 10), the system must keep the remaining prescription active for future fulfillment.
- **Compounded Medications (Extemporaneous):** Ability to correctly handle and bill custom mixtures or IV preparations, utilizing Frappe's Product Bundle or BOM mechanics seamlessly at the POS.

### 3.2. Strict Batch and Expiry Management (Critical)
- **Automated FEFO (First Expire, First Out):** POSAwesome must automatically allocate the batch with the nearest expiry date by default to minimize wastage.
- **Expiry Safeguards:** 
  - **Hard Block:** The system must strictly block the scanning or manual addition of expired batches.
  - **Visual Warnings:** Batches expiring within a configurable window (e.g., 30 or 60 days) should be highlighted in orange/red in the cart and selection dropdowns.
- **Inline Batch Selector:** For manual overrides, the item row in the cart needs a distinct batch selection UI that clearly displays available batch numbers, current warehouse quantities, and expiry dates inline.
- **Cold Chain & Storage Alerts:** Visually flag items requiring special handling (e.g., "Fridge 2-8°C") in the cart so staff pack them with ice packs or appropriate materials during checkout.

### 3.3. Specialized Billing Workflows
- **Insurance and Split Billing:**
  - Integrate with Frappe Healthcare's Patient Insurance features.
  - When an insured patient is loaded, the POS should seamlessly calculate the covered amount (based on policy and item eligibility) and present the remaining **Co-Pay** amount to the cashier.
  - The resulting invoice (`Sales Invoice` or `POS Invoice`, depending on POSAwesome configuration) must properly split the accounting ledgers between the Patient Receivable and Insurance Receivable.
  - **Corporate/TPA Credit Accounts:** Support billing workflows needing pre-authorization or approval codes for specific corporate accounts.
- **Charge to Room / Inpatient Billing:**
  - For admitted patients, provide a specific checkout method: "Charge to Inpatient Bill".
  - This bypasses immediate cash collection and instead creates an unpaid `Sales Invoice` directly linked to the patient's active `Inpatient Record`, consolidating all charges for discharge checkout.
- **Warehouse Stock Issues:** If the POS counter also services hospital staff, provide a "Charge to Warehouse" mode to easily log internal Stock Entries (Material Issue) to specific hospital warehouses (e.g., crash carts, general store) instead of financial sales.
- **Staff Allowances:** Automatic application of employee pricing or HR allowances if the Customer/Patient is identified as hospital staff.

### 3.4. Patient Safety & Clinical Checks
- **Automated Clinical Check Alerts:** When items are added to the cart, the backend should resolve the underlying `Medication` doctypes and asynchronously cross-reference their clinical components against the patient's documented `Patient Allergy` records. If a match is found (or if potential severe Drug-Drug Interactions exist), present a high-priority warning modal to the pharmacist.
- **Dosage Labeling:** Capture the prescribed dosage instructions (e.g., "1 tab after meals") against the cart items. This data must be exposed to the print format so automated label printers can print individual medicine stickers.
- **Counseling Documentation:** For designated high-risk or complex medications, prompt the pharmacist with a checklist or mandatory toggle to document that required patient counseling was performed prior to handover.

### 3.5. Compliance, Roles & Security
- **Scheduled/Restricted Drug Handling:** For high-risk medications (e.g., Narcotics), require a secondary authorization pin/password from a Senior Pharmacist directly on the POS screen before the transaction can be submitted.
- **Controlled Substance Register:** Dispensing narcotics must automatically append a localized log to a specialized "Controlled Substance Register" DocType to satisfy strict regulatory reporting, distinct from standard stock ledgers.
- **Audit Trails:** Ensure the `dispensed_by` (the logged-in pharmacist user) is cleanly tied to every item line for strict auditing.
- **Return to Pharmacy Workflow:** Streamlined workflow for both inpatients (e.g., upon discharge) and outpatients returning unused or incorrect medications. This seamlessly creates Stock Entries or Sales Return Invoices that route items directly back into re-saleable stock and correct the patient's bill or issue a refund.

---

## 4. Proposed Technical Implementation

### 4.1. Frappe Backend Changes (Python / Vuex)
1. **New/Updated API Module (`posawesome/api/pharmacy.py`):**
   - `get_substitutes(item_code)`: Returns a list of equivalent items by looking up the linked `Medication` record and matching its generic composition.
   - `check_clinical_interactions(patient, item_list)`: Returns a boolean and warning message if contraindications or severe drug-drug interactions exist.
   - `calculate_insurance_split(patient, item_dict)`: Distributes total cost into Insurance vs. Co-Pay.
   - `process_warehouse_issue(warehouse, item_dict)`: Creates a Material Issue or Stock Transfer entry for hospital warehouses.
   - `log_controlled_substance(invoice, auth_user)`: Appends an audited entry to the local Controlled Substance Register.
2. **DocType Modifications (Via Custom Fields or Overrides):**
   - **Sales Invoice & POS Invoice (including Item child tables):** The custom fields `prescription_reference`, `prescriber`, `insurance_amount`, `patient_co_pay`, `is_inpatient_charge`, `is_corporate_credit`, `corporate_authorization_code`, `counseling_performed`, and `dispensing_pharmacist` must be added to *both* DocTypes to accommodate any POS configuration.
   - **Medication & Item Linking:** POSAwesome's frontend cache must sync the associated `Medication` doctype data payload. Clinical properties like `generic_name`, `is_scheduled_drug`, `storage_condition` (e.g., Cold Chain), and `requires_counseling` should be managed on the `Medication` record and exposed via the linked `Item` payload during sync.
   - **Sales Return / Stock Entry Profiles:** Standardized automated creation of Sales Returns / Stock Entries to ensure all returned medications are routed back to the main saleable dispensing warehouse.

### 4.2. Frontend Architecture (Vue.js)
1. **Patient Profile Widget Update (`Patient.vue`):**
   - Enhance the current `Patient.vue` component to show: `[Patient Name] | [Age/Gender] | [Ward/Bed] | ⚠️ Allergies: Penicillin`.
2. **Cart Components (`ItemsSelector.vue` / Cart Rows):**
   - Add a "Substitute" icon button next to item names.
   - Inject the batch/expiry tags near the quantity adjusters; enforce batch selection before checkout.
   - **Visual Flags:** Render specific indicator icons (e.g., a 'Snowflake') for Cold Chain items to alert packing staff.
   - **Compounding Support:** UI mechanisms to handle Extemporaneous medicines (expanding Product Bundles into component raw materials visually in the cart).
3. **Payment & Handover Component Enhancements:**
   - **Counseling Modal:** A pre-submission overlay forcing pharmacists to confirm patient counseling for tagged medications.
   - Add "Insurance" split calculations and input fields for "Corporate/TPA Authorization Codes".
   - Add buttons for non-traditional POS workflows: "Charge to Room" (Inpatients) and "Charge to Warehouse" (Warehouse Stock Issues).

## 5. Phased Rollout Strategy

To maintain stability, the changes should be implemented in three phases:

* **Phase 1: Foundation & Safe Dispensing**
  * Auto-FEFO batch allocation, Cold Chain tags, and visual expiry warnings.
  * Prescriber tracking and enhanced pending prescription fetching.
  * Warehouse stock issue (Charge to Warehouse) mode.
  * Capturing dosage instructions for label printing.
* **Phase 2: Billing & Advanced Clinical Safety**
  * Inpatient "Charge to Room" and Corporate/TPA credit account workflows.
  * Automated Clinical Check Alerts (Allergies + Drug-Drug Interactions).
  * Extemporaneous compounding support at the POS.
  * Mandatory counseling documentation upon checkout.
* **Phase 3: Deep Financials & Strict Compliance**
  * Split Insurance / Co-Pay billing logic.
  * Secondary approvals and automated Controlled Substance Register logging.
  * Unified Return-to-Pharmacy automated workflows routing returned items into re-saleable stock.
