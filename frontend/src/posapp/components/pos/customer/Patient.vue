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
				:placeholder="patientFieldPlaceholder"
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
				<!-- Edit icon (left) -->
				<template #prepend-inner>
					<v-tooltip :text="__('Edit patient')" content-class="posa-theme-tooltip">
						<template #activator="{ props }">
							<v-icon
								v-bind="props"
								class="icon-button"
								@mousedown.prevent.stop
								@click.stop="edit_patient"
							>
								mdi-account-edit
							</v-icon>
						</template>
					</v-tooltip>
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

				<!-- Add icon (right) -->
				<template #append-inner>
					<span v-if="isPatientSearchLocked" class="patient-load-percent">
						{{ patientLoadPercent }}%
					</span>
					<v-tooltip :text="__('Add new patient')" content-class="posa-theme-tooltip">
						<template #activator="{ props }">
							<v-icon
								v-bind="props"
								class="icon-button"
								@mousedown.prevent.stop
								@click.stop="new_patient"
							>
								mdi-plus
							</v-icon>
						</template>
					</v-tooltip>
				</template>

				<!-- Dropdown display -->
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
				v-if="isPatientSearchLocked"
				:model-value="patientLoadPercent"
				height="4"
				color="primary"
				class="patient-load-bar"
				rounded
			/>
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

.patient-load-bar {
	position: absolute;
	left: 10px;
	right: 10px;
	bottom: 6px;
	z-index: 2;
	opacity: 0.95;
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

.patient-load-percent {
	font-size: 0.72rem;
	font-weight: 700;
	margin-right: 8px;
	color: rgb(var(--v-theme-primary));
	min-width: 42px;
	text-align: right;
}

@media (max-width: 768px) {
	.patient-input-wrapper {
		padding-right: 0;
	}
}
</style>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from "vue";
import { storeToRefs } from "pinia";
import _ from "lodash";
import { useToastStore } from "../../../stores/toastStore.js";
import { useCustomersStore } from "../../../stores/customersStore.js";
import { usePatientsStore } from "../../../stores/patientsStore.js";

export default {
	props: {
		pos_profile: Object,
	},
	setup(props, { expose, emit }) {
		const { proxy } = getCurrentInstance();
		const toastStore = useToastStore();
		const customersStore = useCustomersStore();
		const patientsStore = usePatientsStore();

		const { 
			selectedPatient, 
			filteredPatients, 
			isPatientBackgroundLoading, 
			loadingPatients, 
			loadProgress, 
			isLoadComplete,
			patientInfo
		} = storeToRefs(patientsStore);

		const internalPatient = ref(null);
		const tempSelectedPatient = ref(null);
		const isMenuOpen = ref(false);
		const patientDropdown = ref(null);
		const readonlyState = ref(false);

		let scrollContainer = null;

		const __ = window.__ || ((text) => text);
		const networkOnline = computed(() => navigator.onLine);
		const effectiveReadonly = computed(() => readonlyState.value);

		const isPatientSearchLocked = computed(() => {
			if (!networkOnline.value) return false;
			const isCurrentlyLoading = loadingPatients.value || isPatientBackgroundLoading.value;
			return isCurrentlyLoading && (!loadProgress.value || loadProgress.value < 100);
		});

		const patientLoadPercent = computed(() =>
			Math.max(0, Math.min(100, Math.round(loadProgress.value || 0))),
		);

		const patientFieldLabel = computed(() => 
			isPatientSearchLocked.value 
				? `${frappe._("Loading patients")} ${patientLoadPercent.value}%`
				: frappe._("Patient"),
		);

		const patientFieldPlaceholder = computed(() => 
			isPatientSearchLocked.value 
				? `${__("Loading patients...")} ${patientLoadPercent.value}%`
				: __("Search patient"),
		);

		const patientNoDataText = computed(() => {
			if (isPatientSearchLocked.value) {
				return `${__("Loading patients...")} ${patientLoadPercent.value}%`;
			}
			return __("Patients not found");
		});

		const searchDebounce = _.debounce((term) => {
			patientsStore.queueSearch(term || "");
		}, 300);

		watch(
			selectedPatient,
			(value) => {
				if (!isMenuOpen.value) {
					internalPatient.value = value || null;
				}
			},
			{ immediate: true },
		);

		watch(
			() => props.pos_profile,
			(profile) => {
				if (profile) {
					patientsStore.setPosProfile(profile);
					patientsStore.get_patient_names();
				}
			},
			{ immediate: true },
		);

		const detachScrollListener = () => {
			if (scrollContainer) {
				scrollContainer.removeEventListener("scroll", onPatientScroll);
				scrollContainer = null;
			}
		};

		const onPatientScroll = async (event) => {
			const el = event.target;
			if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
				await patientsStore.loadMorePatients();
			}
		};

		const attachScrollListener = () => {
			const dropdown = patientDropdown.value?.$el?.querySelector(".v-overlay__content .v-list.v-select-list");
			if (dropdown) {
				scrollContainer = dropdown;
				scrollContainer.addEventListener("scroll", onPatientScroll);
			}
		};

		const onPatientMenuToggle = (isOpen) => {
			isMenuOpen.value = isOpen;
			if (isOpen) {
				internalPatient.value = null;
				nextTick(() => {
					setTimeout(() => {
						attachScrollListener();
					}, 50);
				});
				return;
			}

			detachScrollListener();
			if (tempSelectedPatient.value) {
				internalPatient.value = tempSelectedPatient.value;
				commitPatientChange(tempSelectedPatient.value);
			} else if (selectedPatient.value) {
				internalPatient.value = selectedPatient.value;
			}
			tempSelectedPatient.value = null;
		};

		const closePatientMenu = () => {
			const dropdown = patientDropdown.value;
			if (dropdown) {
				try {
					dropdown.menu = false;
				} catch {
					dropdown.$emit?.("update:menu", false);
				}
				const inputEl = dropdown.$el?.querySelector("input");
				if (inputEl) {
					inputEl.blur();
				}
			}
			isMenuOpen.value = false;
			detachScrollListener();
		};

		const onPatientChange = (val) => {
			if (val && val === selectedPatient.value) {
				internalPatient.value = selectedPatient.value;
				return;
			}

			tempSelectedPatient.value = val;

			if (isMenuOpen.value && val) {
				closePatientMenu();
			} else if (!isMenuOpen.value && val) {
				commitPatientChange(val);
			}
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
				customersStore.setSelectedCustomer(null);
				patientsStore.setSelectedPatient(null);
				patientsStore.setPatientInfo({});
			}
		};

		const onPatientSearch = (value) => {
			if (isPatientSearchLocked.value) {
				return;
			}
			searchDebounce(value || "");
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
				tempSelectedPatient.value = matched.name;
				internalPatient.value = matched.name;
				commitPatientChange(matched.name);
				closePatientMenu();
				if (event?.target?.blur) event.target.blur();
			} else {
				emit("update:patient", null);
			}
		};

		const reload_patients = async () => {
			if (!networkOnline.value) {
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

		const edit_patient = () => {
			patientsStore.openUpdatePatientDialog(patientInfo.value || {});
		};

		const new_patient = () => {
			patientsStore.openUpdatePatientDialog(null);
		};

		const focusPatientSearch = async () => {
			const dropdown = patientDropdown.value;
			if (!dropdown) return;

			try {
				dropdown.menu = true;
			} catch {
				dropdown.$emit?.("update:menu", true);
			}
			isMenuOpen.value = true;

			if (typeof dropdown.focus === "function") {
				dropdown.focus();
			}

			await nextTick();
			const inputEl = dropdown.$el?.querySelector("input");
			if (inputEl) {
				inputEl.focus();
				inputEl.select?.();
			}
		};

		const selectFirstPatient = () => {
			if (!filteredPatients.value?.length) return;
			const first = filteredPatients.value[0];
			tempSelectedPatient.value = first.name;
			internalPatient.value = first.name;
			commitPatientChange(first.name);
			closePatientMenu();
		};

		expose({ focusPatientSearch, selectFirstPatient });

		onMounted(() => {
			if (props.pos_profile) {
				patientsStore.get_patient_names();
			}
		});

		onBeforeUnmount(() => {
			searchDebounce.cancel();
			detachScrollListener();
		});

		return {
			patientDropdown,
			filteredPatients,
			loadingPatients,
			isPatientBackgroundLoading,
			isPatientSearchLocked,
			patientLoadPercent,
			patientFieldLabel,
			patientFieldPlaceholder,
			patientNoDataText,
			internalPatient,
			effectiveReadonly,
			onPatientMenuToggle,
			onPatientChange,
			onPatientSearch,
			handleEnter,
			reload_patients,
			edit_patient,
			new_patient,
			networkOnline,
			focusPatientSearch,
			selectFirstPatient,
		};
	},
};
</script>
