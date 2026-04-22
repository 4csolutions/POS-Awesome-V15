<template>
	<v-row align="start" class="items px-3 py-2">
		<v-col :cols="pos_profile.posa_allow_sales_order ? 9 : 12" class="pb-0 pr-0">
			<!-- Patient selection component -->
			<Patient v-if="isHealthcareInstalled" :pos_profile="pos_profile" class="mb-4" @update:patient="onPatientSelected" />
			<!-- Customer selection component -->
			<Customer ref="customerComponent" />

			<!-- Fetch Medication Requests Button -->
			<div v-if="isHealthcareInstalled && patientId" class="mt-2 text-right">
				<v-btn
					color="primary"
					variant="tonal"
					density="comfortable"
					size="small"
					:loading="fetchingMedications"
					@click="fetchMedicationRequests"
				>
					<v-icon start>mdi-pill</v-icon>
					Fetch Medication
				</v-btn>
			</div>
		</v-col>
		<!-- Invoice Type Selection (Only shown if sales orders are allowed) -->
		<v-col v-if="pos_profile.posa_allow_sales_order" cols="3" class="pb-4">
			<v-select
				density="compact"
				hide-details
				variant="solo"
				color="primary"
				class="sleek-field pos-themed-input"
				:items="invoiceTypes"
				:label="frappe._('Type')"
				:model-value="modelValue"
				@update:model-value="$emit('update:modelValue', $event)"
				:disabled="modelValue == 'Return'"
			></v-select>
		</v-col>

		<FetchMedicationsDialog
			v-model="showMedicationsDialog"
			:patientId="patientId"
			:posProfile="props.pos_profile"
			@add-medications="handleAddMedications"
		/>
	</v-row>
</template>

<script setup>
import { ref, onMounted } from "vue";
import Customer from "../customer/Customer.vue";
import Patient from "../customer/Patient.vue";
import FetchMedicationsDialog from "./FetchMedicationsDialog.vue";
import { useToastStore } from "../../../stores/toastStore.js";
import { useInvoiceStore } from "../../../stores/invoiceStore.js";

const props = defineProps({
	pos_profile: {
		type: Object,
		required: true,
		default: () => ({}),
	},
	invoiceTypes: {
		type: Array,
		default: () => ["Invoice", "Order", "Quotation"],
	},
	modelValue: {
		type: String,
		default: "Invoice",
	},
});

defineEmits(["update:modelValue"]);

const frappe = window.frappe;
const toastStore = useToastStore();
const invoiceStore = useInvoiceStore();

const customerComponent = ref(null);
const patientId = ref(null);
const fetchingMedications = ref(false);
const showMedicationsDialog = ref(false);
const isHealthcareInstalled = ref(false);

const checkHealthcareInstalled = async () => {
	try {
		if (window.frappe?.boot?.installed_apps) {
			isHealthcareInstalled.value = window.frappe.boot.installed_apps.includes("healthcare");
			return;
		}
		const response = await frappe.call({
			method: "posawesome.posawesome.api.patient.is_healthcare_installed"
		});
		isHealthcareInstalled.value = !!response.message;
	} catch (e) {
		console.error("Error checking healthcare installation", e);
	}
};

onMounted(() => {
	checkHealthcareInstalled();
});

const onPatientSelected = (val) => {
	patientId.value = val;
};

const fetchMedicationRequests = () => {
    if (!patientId.value) {
        toastStore.show({
            title: "Please select a patient first",
            color: "warning"
        });
        return;
    }
    showMedicationsDialog.value = true;
};

const handleAddMedications = (selectedItems) => {
    let addedCount = 0;
    for (const item of selectedItems) {
        invoiceStore.addItem(item);
        addedCount++;
    }
    if (addedCount > 0) {
        toastStore.show({
            title: `Added ${addedCount} medication(s) to invoice`,
            color: "success"
        });
    }
};

// Expose focus method for parent
const focusCustomerSearch = () => {
	if (customerComponent.value && typeof customerComponent.value.focusCustomerSearch === "function") {
		customerComponent.value.focusCustomerSearch();
	}
};

const selectFirstCustomer = () => {
	if (customerComponent.value && typeof customerComponent.value.selectFirstCustomer === "function") {
		customerComponent.value.selectFirstCustomer();
	}
};

const openNewCustomer = () => {
	if (customerComponent.value && typeof customerComponent.value.openNewCustomer === "function") {
		customerComponent.value.openNewCustomer();
	}
};

defineExpose({
	focusCustomerSearch,
	selectFirstCustomer,
	openNewCustomer,
});
</script>
