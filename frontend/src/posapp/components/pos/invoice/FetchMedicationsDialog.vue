<template>
	<v-dialog v-model="dialog" max-width="800">
		<v-card class="pos-themed-card">
			<v-card-title class="d-flex justify-space-between align-center">
				<span>{{ frappe._('Select Medications') }}</span>
				<v-btn icon="mdi-close" variant="text" density="compact" @click="dialog = false"></v-btn>
			</v-card-title>
			<v-divider></v-divider>
			<v-card-text class="pa-4">
				<v-select
					v-model="selectedEncounter"
					:items="encounters"
					item-title="label"
					item-value="name"
					:label="frappe._('Patient Encounter')"
					variant="outlined"
					density="compact"
					class="mb-4"
					:loading="fetchingEncounters"
					clearable
					@update:modelValue="fetchMedications"
				></v-select>

				<v-data-table
					v-if="selectedEncounter"
					v-model="selected"
					:headers="headers"
					:items="fetchedMedications"
					:loading="fetchingMedications"
					show-select
					item-value="posa_row_id"
					class="elevation-0"
					:items-per-page="-1"
					hide-default-footer
				>
					<template v-slot:item.batch_no="{ item }">
						<v-select
							v-if="item.has_batch_no"
							v-model="item.batch_no"
							:items="getSortedBatches(item)"
							item-title="batch_no"
							item-value="batch_no"
							density="compact"
							hide-details
							variant="outlined"
							:placeholder="frappe._('Select Batch')"
							class="batch-select"
						>
							<template v-slot:item="{ props: itemProps, item: batchItem }">
								<v-list-item v-bind="itemProps">
									<v-list-item-title>{{ batchItem.raw.batch_no }}</v-list-item-title>
									<v-list-item-subtitle>
										{{ frappe._('Qty') }}: {{ batchItem.raw.available_qty || batchItem.raw.batch_qty }}
										<span v-if="batchItem.raw.expiry_date">| {{ frappe._('Exp') }}: {{ batchItem.raw.expiry_date }}</span>
									</v-list-item-subtitle>
								</v-list-item>
							</template>
						</v-select>
					</template>

					<template v-slot:item.actual_qty="{ item }">
						<span :class="item.actual_qty <= 0 ? 'text-error' : ''">
							{{ item.actual_qty }}
						</span>
					</template>

					<template v-slot:item.qty="{ item }">
						<v-text-field
							v-model.number="item.qty"
							type="number"
							density="compact"
							hide-details
							variant="outlined"
							min="0"
							:max="item.original_qty || item.qty"
							class="qty-input"
						></v-text-field>
					</template>
				</v-data-table>
			</v-card-text>
			<v-divider></v-divider>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn color="error" variant="text" @click="dialog = false">{{ frappe._('Cancel') }}</v-btn>
				<v-btn color="primary" variant="elevated" :disabled="!selected.length" @click="submit">{{ frappe._('Add to Invoice') }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { ref, watch, computed } from "vue";
import { useBatchSerial } from "../../../composables/pos/shared/useBatchSerial";

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	patientId: {
		type: String,
		default: null,
	},
	posProfile: {
		type: Object,
		default: () => ({}),
	},
});

const emit = defineEmits(["update:modelValue", "add-medications"]);

const frappe = window.frappe;
const toastStore = window.pinia?.state?.value?.toastStore || { show: () => {} };

const dialog = computed({
	get: () => props.modelValue,
	set: (val) => emit("update:modelValue", val),
});

const selected = ref([]);
const encounters = ref([]);
const selectedEncounter = ref(null);
const fetchedMedications = ref([]);
const fetchingEncounters = ref(false);
const fetchingMedications = ref(false);

const headers = computed(() => [
	{ title: frappe._("Medication"), key: "item_name", sortable: false },
	{ title: frappe._("Description"), key: "description", sortable: false },
	{ title: frappe._("Requested Qty"), key: "original_qty", sortable: false },
	{ title: frappe._("Available"), key: "actual_qty", sortable: false, width: "100px" },
	{ title: frappe._("Batch"), key: "batch_no", sortable: false, width: "180px" },
	{ title: frappe._("Add Qty"), key: "qty", sortable: false, width: "120px" },
]);

const { getBatchAvailability } = useBatchSerial();

const getSortedBatches = (item) => {
	if (!item.batch_no_data) return [];
	// useBatchSerial sorts by expiry automatically
	const context = { items: [] }; // Empty context for simpler availability calculation
	return getBatchAvailability(item, context).filter(b => (b.available_qty || b.batch_qty) > 0);
};

const fetchEncounters = async () => {
	if (!props.patientId) return;
	fetchingEncounters.value = true;
	encounters.value = [];
	try {
        // Fetch Patient Encounters
		const response = await frappe.call({
			method: "posawesome.posawesome.api.patient.get_pending_medication_encounters",
			args: {
				patient: props.patientId
			}
		});
		
		const list = response.message || [];
		encounters.value = list.map(enc => {
            let formattedDate = enc.encounter_date;
            if (formattedDate && typeof formattedDate === 'string') {
                const parts = formattedDate.split('-');
                if (parts.length === 3) {
                    formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
            }
            const dateStr = formattedDate ? ` (${formattedDate})` : '';
            const pracStr = enc.practitioner_name ? ` with ${enc.practitioner_name}` : '';
            return {
			    name: enc.name,
			    label: `${enc.name}${dateStr}${pracStr}`
            };
		});
	} catch (err) {
		console.error("Error fetching patient encounters", err);
	} finally {
		fetchingEncounters.value = false;
	}
};

const fetchMedications = async (val) => {
	selectedEncounter.value = val;
	fetchedMedications.value = [];
	selected.value = [];
	
	if (!val || !props.patientId) return;
	
	fetchingMedications.value = true;
	try {
		const response = await frappe.call({
			method: "posawesome.posawesome.api.patient.get_patient_medications",
			args: {
				patient: props.patientId,
				pos_profile: props.posProfile ? (props.posProfile.name || props.posProfile) : null,
				encounter: val
			}
		});

		const items = response.message || [];
		fetchedMedications.value = items.map(m => {
			if (m.original_qty === undefined) {
				m.original_qty = m.qty;
			}
			// Auto select first batch if any
			if (m.has_batch_no && m.batch_no_data && m.batch_no_data.length > 0) {
				const sorted = getSortedBatches(m);
				if (sorted.length > 0) {
					m.batch_no = sorted[0].batch_no;
				}
			}
			return m;
		});
		
		// Auto select all
		selected.value = fetchedMedications.value.map(m => m.posa_row_id);
		
	} catch (err) {
		console.error("Error fetching medications for encounter", err);
	} finally {
		fetchingMedications.value = false;
	}
};

watch(
	() => props.modelValue,
	(newVal) => {
		if (newVal) {
			// Dialog opening
			selectedEncounter.value = null;
			fetchedMedications.value = [];
			selected.value = [];
			fetchEncounters();
		}
	}
);

const submit = () => {
    // Return selected items, updating their quantities from the table
	const selectedRows = fetchedMedications.value.filter((m) => selected.value.includes(m.posa_row_id));
	const finalItems = [];
	let skippedCount = 0;

	selectedRows.forEach(row => {
		if (row.qty <= 0) return;

		if (row.has_batch_no) {
			const batches = getSortedBatches(row);
			if (batches.length === 0) {
				skippedCount++;
				return;
			}

			// Prioritize selected batch
			if (row.batch_no) {
				const selectedIdx = batches.findIndex(b => b.batch_no === row.batch_no);
				if (selectedIdx > -1) {
					const [selectedBatch] = batches.splice(selectedIdx, 1);
					batches.unshift(selectedBatch);
				}
			}

			let remainingQty = row.qty;
			for (const batch of batches) {
				if (remainingQty <= 0) break;
				const available = batch.available_qty || batch.batch_qty;
				const take = Math.min(remainingQty, available);
				if (take <= 0) continue;

				const bPrice = flt(batch.batch_price);
				const splitItem = { ...row, qty: take, batch_no: batch.batch_no };
				
				if (bPrice > 0) {
					splitItem.rate = bPrice;
					splitItem.price_list_rate = bPrice;
					splitItem.base_rate = bPrice;
					splitItem.base_price_list_rate = bPrice;
					splitItem.amount = take * bPrice;
				}

				// Ensure new posa_row_id for splits to avoid duplicate keys in cart
				if (remainingQty < row.qty || finalItems.some(i => i.item_code === row.item_code)) {
					splitItem.posa_row_id = frappe.utils.get_random(12);
				}
				finalItems.push(splitItem);
				remainingQty -= take;
			}

			// If still remaining (insufficient stock), user gets what's available
			// or we can add a row with no batch/remainder if allowed.
			// Currently, we just stop at available stock.
		} else {
			finalItems.push({ ...row });
		}
	});

	if (finalItems.length > 0) {
		emit("add-medications", finalItems);
	}

	if (skippedCount > 0) {
		toastStore.show({
			title: `${skippedCount} ${frappe._('item(s) skipped due to zero available stock.')}`,
			color: "warning",
		});
	}
	dialog.value = false;
};
</script>

<style scoped>
.qty-input {
	max-width: 80px;
}
.batch-select {
	min-width: 150px;
}
.text-error {
	color: rgb(var(--v-theme-error)) !important;
}
</style>
