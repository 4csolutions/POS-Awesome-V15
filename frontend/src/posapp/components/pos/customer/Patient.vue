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
				:loading="isPatientSearchLocked"
				v-model="internalPatient"
				:items="filteredPatients"
				item-title="patient_name"
				item-value="name"
				:no-data-text="patientNoDataText"
				hide-details
				:customFilter="() => true"
				:disabled="effectiveReadonly || isPatientSearchLocked"
				:menu-props="{ closeOnContentClick: false }"
				@update:menu="onPatientMenuToggle"
				@update:modelValue="onPatientChange"
				@update:search="onPatientSearch"
				@keydown.enter="handleEnter"
				:virtual-scroll="true"
				:virtual-scroll-item-height="48"
			>
				<!-- Prepend Reload Icon -->
				<template #prepend-inner>
					<v-tooltip :text="__('Reload patients')" content-class="posa-theme-tooltip">
						<template #activator="{ props }">
							<v-icon
								v-bind="props"
								class="icon-button ml-1"
								:class="{ 'disabled-icon': !networkOnline }"
								@mousedown.prevent.stop
								@click.stop="reload_patients"
							>
								mdi-reload
							</v-icon>
						</template>
					</v-tooltip>
				</template>

				<!-- Append Load Percent -->
				<template #append-inner>
					<span v-if="isPatientSearchLocked" class="patient-load-percent">
						{{ patientLoadPercent }}%
					</span>
				</template>

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
			<v-progress-linear
				v-if="syncState.showProgress"
				:model-value="syncState.progress"
				:color="syncState.color"
				height="2"
				class="sync-progress"
			></v-progress-linear>
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

.icon-button {
	cursor: pointer;
	color: var(--v-theme-primary);
	opacity: 0.8;
	transition: all 0.2s ease;
}

.icon-button:hover:not(.disabled-icon) {
	opacity: 1;
	transform: scale(1.1);
}

.disabled-icon {
	opacity: 0.3 !important;
	cursor: not-allowed !important;
}

.sync-progress {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	border-radius: 0 0 12px 12px;
}

.patient-load-percent {
	font-size: 0.75rem;
	color: var(--v-theme-primary);
	opacity: 0.8;
	margin-right: 4px;
	font-weight: 500;
}
</style>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { useToastStore } from "../../../stores/toastStore.js";
import { useCustomersStore } from "../../../stores/customersStore.js";
import { usePatientsStore } from "../../../stores/patientsStore.js";

const props = defineProps({
	pos_profile: {
		type: Object,
		required: true,
	}
});

const emit = defineEmits(["update:patient"]);

const __ = window.__ || ((text) => text);
const toastStore = useToastStore();
const customersStore = useCustomersStore();
const patientsStore = usePatientsStore();

const { filteredPatients, isPatientBackgroundLoading, loadingPatients, loadProgress, isLoadComplete } = storeToRefs(patientsStore);

const internalPatient = ref(null);
const patientDropdown = ref(null);
const isMenuOpen = ref(false);
const readonlyState = ref(false);
const tempSelectedPatient = ref(null);

watch(
	() => props.pos_profile,
	(newProfile) => {
		if (newProfile) {
			patientsStore.setPosProfile(newProfile);
			patientsStore.get_patient_names();
		}
	},
	{ immediate: true },
);

const effectiveReadonly = computed(() => readonlyState.value);
const patientFieldLabel = computed(() => __("Patient"));
const networkOnline = computed(() => navigator.onLine);

const isPatientSearchLocked = computed(() => {
	if (!navigator.onLine) return false;
	const isCurrentlyLoading = loadingPatients.value || isPatientBackgroundLoading.value;
	return isCurrentlyLoading && (!loadProgress.value || loadProgress.value < 100);
});

const patientLoadPercent = computed(() => {
	if (!isPatientSearchLocked.value) return 100;
	return Math.round(loadProgress.value || 0);
});

const syncState = computed(() => {
	const progress = loadProgress.value || 0;
	if (progress === 100 && isLoadComplete.value) {
		return { showProgress: false, progress: 100, color: "success" };
	}
	const show = loadingPatients.value || isPatientBackgroundLoading.value;
	return {
		showProgress: show,
		progress,
		color: progress > 0 ? "primary" : "secondary",
	};
});

const patientNoDataText = computed(() => {
	if (isPatientBackgroundLoading.value || loadingPatients.value) {
		return __("Loading patients...");
	}
	return __("Patients not found");
});

const reload_patients = async () => {
	if (!navigator.onLine) {
		toastStore.show({
			title: __("Offline"),
			text: __("Cannot reload patients while offline."),
			color: "warning",
		});
		return;
	}
	await patientsStore.reloadPatients();
	toastStore.show({
		title: __("Patients Reloaded"),
		color: "success",
	});
};

const commitPatientChange = (val) => {
	emit("update:patient", val || null);
	patientsStore.setSelectedPatient(val || null);
	
	if (val) {
		const selected = filteredPatients.value.find((p) => p.name === val);
		if (selected && selected.customer) {
			customersStore.searchCustomers(selected.customer).then(() => {
				customersStore.setSelectedCustomer(selected.customer);
			});
		} else if (selected) {
			toastStore.show({
				title: __("No customer linked to this patient"),
				color: "warning",
			});
		}
	} else {
		// Clear customer if patient is cleared
		customersStore.searchCustomers("").then(() => {
			customersStore.setSelectedCustomer("");
		});
	}
};

const onPatientMenuToggle = (isOpen) => {
	isMenuOpen.value = isOpen;
	if (isOpen) {
		internalPatient.value = null;
		
		// Setup scroll listener for infinite scroll
		nextTick(() => {
			const listEl = document.querySelector('.v-overlay-container .v-list.v-select-list');
			if (listEl) {
				listEl.addEventListener('scroll', handlePatientScroll);
			}
		});
	} else {
		// Clean up scroll listener
		const listEl = document.querySelector('.v-overlay-container .v-list.v-select-list');
		if (listEl) {
			listEl.removeEventListener('scroll', handlePatientScroll);
		}
		
		if (tempSelectedPatient.value) {
			internalPatient.value = tempSelectedPatient.value;
			commitPatientChange(tempSelectedPatient.value);
		}
	}
};

const onPatientChange = (val) => {
	tempSelectedPatient.value = val;

	if (isMenuOpen.value && val) {
		const dropdown = patientDropdown.value;
		if (dropdown) dropdown.menu = false;
		isMenuOpen.value = false;
	} else if (!isMenuOpen.value && val) {
		commitPatientChange(val);
	}
};

let searchTimeout;
const onPatientSearch = (value) => {
	clearTimeout(searchTimeout);
	searchTimeout = setTimeout(() => {
		patientsStore.queueSearch(value || "");
	}, 300);
};

const handleEnter = (event) => {
	const inputText = event.target.value?.toLowerCase() || "";
	const matched = filteredPatients.value.find((p) => {
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

const handlePatientScroll = async (e) => {
	const { scrollTop, clientHeight, scrollHeight } = e.target;
	if (scrollHeight - scrollTop <= clientHeight + 100) {
		await patientsStore.loadMorePatients();
	}
};

onMounted(() => {
	if (props.pos_profile) {
		patientsStore.get_patient_names();
	}
});

onUnmounted(() => {
	clearTimeout(searchTimeout);
	const listEl = document.querySelector('.v-overlay-container .v-list.v-select-list');
	if (listEl) {
		listEl.removeEventListener('scroll', handlePatientScroll);
	}
});
</script>
