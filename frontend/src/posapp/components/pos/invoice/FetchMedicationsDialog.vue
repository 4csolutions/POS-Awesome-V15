<template>
	<v-dialog v-model="dialog" max-width="1050">
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

				<v-autocomplete
					v-if="selectedEncounter"
					v-model="addItemSelection"
					v-model:search="addItemSearch"
					:items="searchItemResults"
					:loading="searchingItems"
					item-title="item_name"
					item-value="item_code"
					return-object
					no-filter
					clearable
					density="compact"
					hide-details
					variant="outlined"
					:label="frappe._('Add Item / Alternative to List')"
					:placeholder="frappe._('Search by item name or code...')"
					prepend-inner-icon="mdi-plus-circle-outline"
					class="mb-3"
					@update:search="onSearchItems"
					@update:modelValue="onAddItemToList"
				>
					<template v-slot:item="{ props: itemProps, item: searchItem }">
						<v-list-item v-bind="itemProps">
							<v-list-item-subtitle>
								{{ searchItem.raw.item_code }} | {{ frappe._('Qty') }}: {{ searchItem.raw.actual_qty ?? 0 }}
							</v-list-item-subtitle>
						</v-list-item>
					</template>
				</v-autocomplete>

				<v-data-table
					v-if="selectedEncounter"
					:headers="headers"
					:items="fetchedMedications"
					:loading="fetchingMedications"
					item-value="posa_row_id"
					class="elevation-0"
					:items-per-page="-1"
					hide-default-footer
				>
					<template v-slot:item.item_name="{ item }">
						<div v-if="editingRowId === item.posa_row_id" class="d-flex align-center gap-1">
							<v-autocomplete
								v-model:search="editItemSearch"
								:items="editSearchResults"
								:loading="searchingEditItems"
								item-title="item_name"
								item-value="item_code"
								return-object
								no-filter
								autofocus
								density="compact"
								hide-details
								variant="outlined"
								:placeholder="frappe._('Search alternative...')"
								class="edit-item-select"
								@update:search="onSearchEditItems"
								@update:modelValue="(val) => onReplaceItem(item, val)"
							>
								<template v-slot:item="{ props: itemProps, item: altItem }">
									<v-list-item v-bind="itemProps">
										<v-list-item-subtitle>
											{{ altItem.raw.item_code }} | {{ frappe._('Qty') }}: {{ altItem.raw.actual_qty ?? 0 }}
										</v-list-item-subtitle>
									</v-list-item>
								</template>
							</v-autocomplete>
							<v-btn icon="mdi-close" size="x-small" variant="text" @click="editingRowId = null"></v-btn>
						</div>
						<div v-else class="d-flex align-center justify-space-between">
							<span>{{ item.item_name }}</span>
							<v-btn
								icon="mdi-swap-horizontal"
								size="x-small"
								variant="text"
								color="primary"
								:title="frappe._('Select Alternative')"
								@click="startEditRow(item)"
							></v-btn>
						</div>
					</template>

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
							class="qty-input"
						></v-text-field>
					</template>

					<template v-slot:item.actions="{ item }">
						<v-btn
							icon="mdi-delete-outline"
							size="x-small"
							variant="text"
							color="error"
							:title="frappe._('Remove')"
							@click="removeRow(item)"
						></v-btn>
					</template>
				</v-data-table>
			</v-card-text>
			<v-divider></v-divider>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn color="error" variant="text" @click="dialog = false">{{ frappe._('Cancel') }}</v-btn>
				<v-btn color="primary" variant="elevated" :disabled="!fetchedMedications.length" @click="submit">{{ frappe._('Add to Invoice') }}</v-btn>
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

const addItemSelection = ref(null);
const addItemSearch = ref("");
const searchItemResults = ref([]);
const searchingItems = ref(false);

const editingRowId = ref(null);
const editItemSearch = ref("");
const editSearchResults = ref([]);
const searchingEditItems = ref(false);

let searchTimer = null;
let editSearchTimer = null;

const searchPosItems = async (query) => {
	if (!query || query.trim().length < 2) return [];
	const response = await frappe.call({
		method: "posawesome.posawesome.api.items.get_items",
		args: {
			pos_profile: JSON.stringify(props.posProfile || {}),
			search_value: query.trim(),
			limit: 20,
		},
	});
	return response.message || [];
};

const onSearchItems = (val) => {
	clearTimeout(searchTimer);
	if (!val || val.trim().length < 2) {
		searchItemResults.value = [];
		return;
	}
	searchTimer = setTimeout(async () => {
		searchingItems.value = true;
		try {
			searchItemResults.value = await searchPosItems(val);
		} catch (e) {
			console.error("Error searching items", e);
		} finally {
			searchingItems.value = false;
		}
	}, 250);
};

const onAddItemToList = (item) => {
	if (!item || !item.item_code) return;
	const newRow = {
		...item,
		posa_row_id: frappe.utils.get_random(12),
		original_qty: 1,
		qty: 1,
	};
	if (newRow.has_batch_no && newRow.batch_no_data?.length > 0) {
		const sorted = getSortedBatches(newRow);
		if (sorted.length > 0) {
			newRow.batch_no = sorted[0].batch_no;
		}
	}
	fetchedMedications.value.push(newRow);
	selected.value.push(newRow.posa_row_id);
	addItemSelection.value = null;
	addItemSearch.value = "";
	searchItemResults.value = [];
};

const startEditRow = (row) => {
	editingRowId.value = row.posa_row_id;
	editItemSearch.value = "";
	editSearchResults.value = [];
};

const onSearchEditItems = (val) => {
	clearTimeout(editSearchTimer);
	if (!val || val.trim().length < 2) {
		editSearchResults.value = [];
		return;
	}
	editSearchTimer = setTimeout(async () => {
		searchingEditItems.value = true;
		try {
			editSearchResults.value = await searchPosItems(val);
		} catch (e) {
			console.error("Error searching alternative items", e);
		} finally {
			searchingEditItems.value = false;
		}
	}, 250);
};

const onReplaceItem = (row, altItem) => {
	if (!altItem || !altItem.item_code) return;
	const preservedRowId = row.posa_row_id;
	const preservedOrigQty = row.original_qty;
	const preservedQty = row.qty > 0 ? row.qty : 1;

	Object.assign(row, altItem, {
		posa_row_id: preservedRowId,
		original_qty: preservedOrigQty,
		qty: preservedQty,
		batch_no: null,
	});

	if (row.has_batch_no && row.batch_no_data?.length > 0) {
		const sorted = getSortedBatches(row);
		if (sorted.length > 0) {
			row.batch_no = sorted[0].batch_no;
		}
	}
	editingRowId.value = null;
	editItemSearch.value = "";
	editSearchResults.value = [];
};

const removeRow = (row) => {
	fetchedMedications.value = fetchedMedications.value.filter(
		(m) => m.posa_row_id !== row.posa_row_id
	);
	selected.value = selected.value.filter((id) => id !== row.posa_row_id);
	if (editingRowId.value === row.posa_row_id) {
		editingRowId.value = null;
	}
};

const headers = computed(() => [
	{ title: frappe._("Medication"), key: "item_name", sortable: false, minWidth: "240px" },
	{ title: frappe._("Description"), key: "description", sortable: false, minWidth: "160px" },
	{ title: frappe._("Requested Qty"), key: "original_qty", sortable: false, width: "110px" },
	{ title: frappe._("Available"), key: "actual_qty", sortable: false, width: "95px" },
	{ title: frappe._("Batch"), key: "batch_no", sortable: false, width: "185px" },
	{ title: frappe._("Add Qty"), key: "qty", sortable: false, width: "130px" },
	{ title: "", key: "actions", sortable: false, width: "48px" },
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
			    label: `${enc.name}${dateStr}${pracStr}`,
			    practitioner: enc.practitioner || null,
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
    // Return all remaining items in the dialog, updating their quantities from the table
	const selectedRows = fetchedMedications.value;
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
				const itemRate = bPrice > 0 ? bPrice : (flt(row.rate) || flt(row.price_list_rate) || 0);
				const splitItem = {
					...row,
					qty: take,
					batch_no: batch.batch_no,
					rate: itemRate,
					price_list_rate: itemRate,
					base_rate: itemRate,
					base_price_list_rate: itemRate,
					amount: take * itemRate,
				};

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
			const itemRate = flt(row.rate) || flt(row.price_list_rate) || 0;
			finalItems.push({
				...row,
				rate: itemRate,
				price_list_rate: itemRate,
				base_rate: itemRate,
				base_price_list_rate: itemRate,
				amount: row.qty * itemRate,
			});
		}
	});

	if (finalItems.length > 0) {
		const encounterObj = encounters.value.find(e => e.name === selectedEncounter.value);
		emit("add-medications", finalItems, encounterObj?.practitioner || null);
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
	min-width: 96px;
	width: 105px;
}
.edit-item-select {
	min-width: 230px;
}
.batch-select {
	min-width: 165px;
}
.text-error {
	color: rgb(var(--v-theme-error)) !important;
}
</style>
