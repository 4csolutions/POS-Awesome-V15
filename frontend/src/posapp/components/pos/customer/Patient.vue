<template>
	<div class="patient-input-wrapper">
		<div class="patient-field-shell">
			<v-autocomplete
				ref="patientDropdown"
				class="patient-autocomplete sleek-field pos-themed-input"
				density="compact"
				clearable
				variant="solo"
				color="primary"
				:label="patientFieldLabel"
				placeholder="Search patient"
				:loading="loadingPatients"
				v-model="internalPatient"
				:items="patients"
				item-title="patient_name"
				item-value="name"
				no-data-text="Patients not found"
				hide-details
				:customFilter="() => true"
				:disabled="effectiveReadonly || loadingPatients"
				:menu-props="{ closeOnContentClick: false }"
				@update:menu="onPatientMenuToggle"
				@update:modelValue="onPatientChange"
				@update:search="onPatientSearch"
				@keydown.enter="handleEnter"
				:virtual-scroll="true"
				:virtual-scroll-item-height="48"
			>
				<template #item="{ props, item }">
					<v-list-item v-bind="props">
						<v-list-item-subtitle v-if="item.raw.patient_name !== item.raw.name">
							<div v-html="`ID: ${item.raw.name}`"></div>
						</v-list-item-subtitle>
						<v-list-item-subtitle v-if="item.raw.mobile">
							<div v-html="`Mobile No: ${item.raw.mobile}`"></div>
						</v-list-item-subtitle>
					</v-list-item>
				</template>
			</v-autocomplete>
		</div>
	</div>
</template>

<style scoped>
.patient-input-wrapper {
	width: 100%;
	max-width: 100%;
	padding-right: 1.5rem;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	position: relative;
}

.patient-autocomplete {
	width: 100%;
	box-sizing: border-box;
	border-radius: 12px;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
	transition: box-shadow 0.3s ease;
	background-color: var(--pos-input-bg);
}

.patient-field-shell {
	position: relative;
	width: 100%;
}

.patient-autocomplete:hover {
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.patient-autocomplete :deep(.v-field__input),
.patient-autocomplete :deep(input),
.patient-autocomplete :deep(.v-label) {
	color: var(--pos-text-primary) !important;
}

.patient-autocomplete :deep(.v-field__overlay) {
	background-color: var(--pos-input-bg) !important;
}
</style>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import _ from "lodash";
import { useToastStore } from "../../../stores/toastStore.js";
import { useCustomersStore } from "../../../stores/customersStore.js";

const props = defineProps({
	pos_profile: {
		type: Object,
		required: true,
	}
});

const emit = defineEmits(["update:patient"]);

const frappe = window.frappe;
const toastStore = useToastStore();
const customersStore = useCustomersStore();

const patients = ref([]);
const internalPatient = ref(null);
const loadingPatients = ref(false);
const isMenuOpen = ref(false);
const patientDropdown = ref(null);
const readonlyState = ref(false);

const effectiveReadonly = computed(() => readonlyState.value);
const patientFieldLabel = computed(() => "Patient");

const getPatients = async (searchTerm = "") => {
	loadingPatients.value = true;
	try {
        const filters = { status: ["!=", "Disabled"] };
		const response = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Patient",
				filters: filters,
				fields: ["name", "patient_name", "mobile", "customer"],
				or_filters: searchTerm ? {
					name: ["like", `%${searchTerm}%`],
					patient_name: ["like", `%${searchTerm}%`],
					mobile: ["like", `%${searchTerm}%`]
				} : {},
				limit_page_length: 20
			}
		});
		patients.value = response.message || [];
	} catch (error) {
		console.error("Error fetching patients", error);
	} finally {
		loadingPatients.value = false;
	}
};

const searchDebounce = _.debounce((term) => {
	getPatients(term || "");
}, 300);

const onPatientMenuToggle = (isOpen) => {
	isMenuOpen.value = isOpen;
};

const onPatientChange = async (val) => {
    emit("update:patient", val || null);
	if (val) {
		const selected = patients.value.find(p => p.name === val);
		if (selected && selected.customer) {
			// Auto-select corresponding customer
            customersStore.searchCustomers(selected.customer).then(() => {
			    customersStore.setSelectedCustomer(selected.customer);
            });
		} else if (selected) {
            toastStore.show({
                title: "No customer linked to this patient",
                color: "warning",
            });
        }
	} else {
        // Patient cleared -> clear customer or reset to pos profile default
        customersStore.searchCustomers("").then(() => {
            const defaultCustomer = props.pos_profile?.customer;
            customersStore.setSelectedCustomer(defaultCustomer || "");
        });
    }
};

const onPatientSearch = (value) => {
	const term = value || "";
	searchDebounce(term);
};

const handleEnter = (event) => {
	const inputText = event.target.value?.toLowerCase() || "";
	const matched = patients.value.find((p) => {
		return (
			p.patient_name?.toLowerCase().includes(inputText) ||
			p.name?.toLowerCase().includes(inputText) ||
            p.mobile?.includes(inputText)
		);
	});

	if (matched) {
		internalPatient.value = matched.name;
		onPatientChange(matched.name);
		const dropdown = patientDropdown.value;
		if (dropdown) dropdown.menu = false;
		if (event?.target?.blur) event.target.blur();
	} else {
        emit("update:patient", null);
    }
};

onMounted(() => {
	getPatients("");
});

onBeforeUnmount(() => {
	searchDebounce.cancel();
});
</script>
