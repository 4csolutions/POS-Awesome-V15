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
	{ title: frappe._("Add Qty"), key: "qty", sortable: false, width: "120px" },
]);

const fetchEncounters = async () => {
	if (!props.patientId) return;
	fetchingEncounters.value = true;
	encounters.value = [];
	try {
        // Fetch Patient Encounters
		const response = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Patient Encounter",
				filters: {
					patient: props.patientId,
					docstatus: 1
				},
				fields: ["name", "title", "encounter_date", "encounter_time", "practitioner_name", "creation"],
                order_by: "creation desc"
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
	const selectedItems = fetchedMedications.value.filter((m) => selected.value.includes(m.posa_row_id));
	emit("add-medications", selectedItems);
	dialog.value = false;
};
</script>

<style scoped>
.qty-input {
	max-width: 100px;
}
</style>
