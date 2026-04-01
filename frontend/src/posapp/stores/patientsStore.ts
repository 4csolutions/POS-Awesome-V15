import { defineStore } from "pinia";
import { ref, computed } from "vue";

declare const frappe: any;
declare const __: any;
import type { POSProfile } from "../types/models";
type Patient = Record<string, any>;
// @ts-ignore
import {
	db,
	checkDbHealth,
	setPatientStorage,
	memoryInitPromise,
	getPatientsLastSync,
	setPatientsLastSync,
	getPatientStorageCount,
	clearPatientStorage,
	isOffline,
} from "../../offline/index";

const PAGE_SIZE = 1000;
const PATIENT_SCOPE_STORAGE_KEY = "posa_patients_profile_scope";

function getPatientProfileScope(profile: POSProfile | null): string {
	const profileName =
		typeof profile?.name === "string" ? profile.name.trim() : "";
	return profileName || "";
}

function getStoredPatientScope(): string {
	if (typeof localStorage === "undefined") {
		return "";
	}
	const stored = localStorage.getItem(PATIENT_SCOPE_STORAGE_KEY);
	return typeof stored === "string" ? stored : "";
}

function setStoredPatientScope(scope: string): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	if (scope) {
		localStorage.setItem(PATIENT_SCOPE_STORAGE_KEY, scope);
		return;
	}
	localStorage.removeItem(PATIENT_SCOPE_STORAGE_KEY);
}

function normalizeSearchTerm(term: string | null | undefined): string {
	if (typeof term !== "string") {
		return "";
	}
	return term.trim();
}

function normalizeProfile(profile: any): POSProfile | null {
	if (!profile) {
		return null;
	}

	let resolved = profile;

	if (profile.pos_profile) {
		resolved = profile.pos_profile;
	}

	if (typeof resolved === "string") {
		const trimmed = resolved.trim();
		if (!trimmed) {
			return null;
		}

		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			try {
				return JSON.parse(trimmed);
			} catch (err) {
				console.error("Failed to parse POS profile JSON", err);
				return null;
			}
		}

		return { name: trimmed } as POSProfile;
	}

	return resolved as POSProfile;
}

function getSerializedProfile(profile: any): string | null {
	if (!profile) {
		return null;
	}

	if (typeof profile === "string") {
		const trimmed = profile.trim();
		if (!trimmed) {
			return null;
		}
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			return trimmed;
		}
		return JSON.stringify({ name: trimmed });
	}

	let fallbackName = null;
	if (typeof profile === "object" && profile !== null) {
		if (typeof profile.name === "string") {
			fallbackName = profile.name;
		} else if (typeof profile.pos_profile === "string") {
			fallbackName = profile.pos_profile;
		} else if (profile.pos_profile?.name) {
			fallbackName = profile.pos_profile.name;
		}
	}

	try {
		return JSON.stringify(profile);
	} catch (err) {
		console.error("Failed to serialize POS profile", err);
		if (fallbackName) {
			return JSON.stringify({ name: fallbackName });
		}
		return null;
	}
}

export const usePatientsStore = defineStore("patients", () => {
	const patients = ref<Patient[]>([]);
	const selectedPatient = ref<string | null>(null);
	const patientInfo = ref<Record<string, any>>({});
	const searchTerm = ref("");
	const page = ref(0);
	const hasMore = ref(true);
	const nextPatientStart = ref<string | null>(null);
	const loadingPatients = ref(false);
	const patientsLoaded = ref(false);
	const isPatientBackgroundLoading = ref(false);
	const pendingPatientSearch = ref<string | null>(null);
	const loadProgress = ref(0);
	const totalPatientCount = ref(0);
	const loadedPatientCount = ref(0);
	const posProfile = ref<POSProfile | null>(null);
	const patientProfileScope = ref("");
	const refreshToken = ref(0);
	const isUpdatePatientDialogOpen = ref(false);
	const patientToUpdate = ref<Patient | null>(null);
	let patientFetchPromise: Promise<void> | null = null;
	const patientLoadLogState = {
		local: false,
		server: false,
		final: false,
	};

	function resetPatientLoadLogState() {
		patientLoadLogState.local = false;
		patientLoadLogState.server = false;
		patientLoadLogState.final = false;
	}

	function logLocalPatientCount(count: number) {
		if (patientLoadLogState.local) return;
		console.log(`Local patient count: ${count}`);
		patientLoadLogState.local = true;
	}

	function logServerPatientCount(count: number) {
		if (patientLoadLogState.server) return;
		console.log(`Server patient count: ${count}`);
		patientLoadLogState.server = true;
	}

	function logFinalLoadedPatientCount() {
		if (patientLoadLogState.final) return;
		const count = Number(loadedPatientCount.value || patients.value.length || 0);
		console.log(`Patients loaded: ${count}`);
		patientLoadLogState.final = true;
	}

	const filteredPatients = computed(() => patients.value);

	const isLoadComplete = computed(
		() => patientsLoaded.value && loadProgress.value >= 100,
	);

	async function ensureDatabase() {
		await memoryInitPromise;
		await checkDbHealth();
		if (!db.isOpen()) {
			await db.open();
		}
	}

	function resetPagination() {
		page.value = 0;
		hasMore.value = true;
		patients.value = [];
	}

	function setPosProfile(profile: any) {
		posProfile.value = normalizeProfile(profile);
		patientProfileScope.value = getPatientProfileScope(posProfile.value);
	}

	function setSelectedPatient(name: string | null) {
		selectedPatient.value = name || null;
	}

	function setPatientInfo(info: Record<string, any>) {
		patientInfo.value = info || {};
	}

	function requestPatientRefresh() {
		refreshToken.value += 1;
	}

	async function ensurePatientScopeIsolation() {
		const currentScope =
			patientProfileScope.value || getPatientProfileScope(posProfile.value);
		if (!currentScope) {
			return;
		}

		const storedScope = getStoredPatientScope();
		if (storedScope === currentScope) {
			return;
		}

		await clearPatientStorage();
		setPatientsLastSync(null);
		setStoredPatientScope(currentScope);
		resetPagination();
		patientsLoaded.value = false;
		loadProgress.value = 0;
		totalPatientCount.value = 0;
		loadedPatientCount.value = 0;
		nextPatientStart.value = null;
	}

	async function performSearch({ append = false } = {}) {
		await ensureDatabase();

		let collection = db.table("patients");
		const normalizedTerm = normalizeSearchTerm(searchTerm.value);
		if (normalizedTerm) {
			const searchParts = normalizedTerm
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean);
			collection = collection.filter((patient: Patient) => {
				if (!patient) {
					return false;
				}

				const values = [
					patient.patient_name,
					patient.name,
					patient.mobile,
					patient.customer,
				]
					.filter((value) => value !== null && value !== undefined)
					.map((value) => String(value).toLowerCase());

				if (!searchParts.length) {
					return true;
				}

				return searchParts.every((part) =>
					values.some((value) => value.includes(part)),
				);
			});
		}

		const offset = page.value * PAGE_SIZE;
		const results = await collection
			.offset(offset)
			.limit(PAGE_SIZE)
			.toArray();

		if (append) {
			patients.value = [...patients.value, ...results];
		} else {
			patients.value = results;
		}

		hasMore.value = results.length === PAGE_SIZE;
		if (hasMore.value) {
			page.value += 1;
		}

		return results.length;
	}

	async function searchPatients(term = "", append = false) {
		if (!append) {
			searchTerm.value = normalizeSearchTerm(term);
			resetPagination();
		}
		return performSearch({ append });
	}

	async function queueSearch(term: string) {
		const normalized = normalizeSearchTerm(term);
		if (isPatientBackgroundLoading.value) {
			pendingPatientSearch.value = normalized;
			return null;
		}
		return searchPatients(normalized, false);
	}

	async function loadMorePatients() {
		if (loadingPatients.value) {
			return 0;
		}
		const count = await performSearch({ append: true });
		if (count === PAGE_SIZE) {
			return count;
		}
		if (nextPatientStart.value) {
			await backgroundLoadPatients(
				nextPatientStart.value,
				getPatientsLastSync(),
			);
			await performSearch({ append: true });
		}
		return count;
	}

	function fetchPatientPage(
		startAfter: string | null,
		modifiedAfter: string | null,
		limit: number,
	): Promise<Patient[]> {
		const serializedProfile = getSerializedProfile(posProfile.value);
		return new Promise((resolve, reject) => {
			if (!serializedProfile) {
				resolve([]);
				return;
			}
			frappe.call({
				method: "posawesome.posawesome.api.patient.get_patient_names",
				args: {
					pos_profile: serializedProfile,
					modified_after: modifiedAfter,
					limit,
					start_after: startAfter,
				},
				callback: (r: any) => resolve(r.message || []),
				error: (err: any) => {
					console.error("Failed to fetch patients", err);
					reject(err);
				},
			});
		});
	}

	async function backgroundLoadPatients(
		startAfter: string | null,
		syncSince: string | null,
	) {
		if (!posProfile.value || isOffline()) {
			return;
		}
		const serializedProfile = getSerializedProfile(posProfile.value);
		if (!serializedProfile) {
			return;
		}
		const limit = PAGE_SIZE;
		isPatientBackgroundLoading.value = true;
		try {
			let cursor: string | null = startAfter;
			while (cursor) {
				const rows: Patient[] = await fetchPatientPage(
					cursor,
					syncSince,
					limit,
				);
				if (rows.length) {
					await setPatientStorage(rows);
					loadedPatientCount.value += rows.length;
					if (totalPatientCount.value) {
						const progress = Math.min(
							100,
							Math.round(
								(loadedPatientCount.value /
									totalPatientCount.value) *
									100,
							),
						);
						loadProgress.value = progress;
					}
				}
				if (rows.length === limit) {
					cursor = rows[rows.length - 1]?.name || null;
					nextPatientStart.value = cursor;
				} else {
					cursor = null;
					nextPatientStart.value = null;
					setPatientsLastSync(new Date().toISOString());
					loadProgress.value = 100;
					patientsLoaded.value = true;
					logFinalLoadedPatientCount();
				}
			}
		} catch (err) {
			console.error("Failed to background load patients", err);
		} finally {
			isPatientBackgroundLoading.value = false;
			if (
				!nextPatientStart.value &&
				patientsLoaded.value &&
				loadProgress.value >= 99
			) {
				loadProgress.value = 100;
			}
			if (pendingPatientSearch.value !== null) {
				const term = pendingPatientSearch.value;
				pendingPatientSearch.value = null;
				await searchPatients(term);
			}
		}
	}

	async function verifyServerPatientCount() {
		if (!posProfile.value || isOffline()) {
			return;
		}
		try {
			const localCount = await getPatientStorageCount();
			const serializedProfile = getSerializedProfile(posProfile.value);
			if (!serializedProfile) {
				return;
			}
			const response = await (frappe.call as any)({
				method: "posawesome.posawesome.api.patient.get_patients_count",
				args: { pos_profile: serializedProfile },
			});
			const serverCount = response.message || 0;
			logServerPatientCount(serverCount);
			totalPatientCount.value = serverCount;
			loadedPatientCount.value = localCount;
			loadProgress.value = serverCount
				? Math.round((localCount / serverCount) * 100)
				: 0;

			if (serverCount > localCount) {
				const syncSince = getPatientsLastSync();
				const rows: Patient[] = await fetchPatientPage(
					null,
					syncSince,
					PAGE_SIZE,
				);
				if (rows.length) {
					await setPatientStorage(rows);
					loadedPatientCount.value += rows.length;
					if (totalPatientCount.value) {
						loadProgress.value = Math.min(
							100,
							Math.round(
								(loadedPatientCount.value /
									totalPatientCount.value) *
									100,
							),
						);
					}
				}
				const startAfter =
					rows.length === PAGE_SIZE
						? rows[rows.length - 1]?.name || null
						: null;
				if (startAfter) {
					await backgroundLoadPatients(startAfter, syncSince);
				} else {
					setPatientsLastSync(new Date().toISOString());
					loadProgress.value = 100;
					patientsLoaded.value = true;
					logFinalLoadedPatientCount();
				}
				await searchPatients(searchTerm.value);
			} else if (serverCount < localCount) {
				await clearPatientStorage();
				setPatientsLastSync(null);
				resetPagination();
				await load_patient_names_internal();
			} else {
				if (patientsLoaded.value || localCount > 0) {
					logFinalLoadedPatientCount();
				}
			}
		} catch (err) {
			console.error("Error verifying patient count:", err);
		}
	}

	async function load_patient_names_internal() {
		if (!posProfile.value) {
			console.debug("Patient fetch skipped: POS Profile not ready");
			return;
		}
		await ensurePatientScopeIsolation();
		const serializedProfile = getSerializedProfile(posProfile.value);
		if (!serializedProfile) {
			return;
		}

		await ensureDatabase();
		const localCount = await getPatientStorageCount();
		logLocalPatientCount(localCount);

		if (localCount > 0) {
			patientsLoaded.value = true;
			await searchPatients(searchTerm.value);
			await verifyServerPatientCount();
			if (!nextPatientStart.value) {
				logFinalLoadedPatientCount();
			}
			return;
		}

		let syncSince = getPatientsLastSync();
		// Ensure syncSince is a valid ISO string or null.
		if (
			!syncSince ||
			syncSince === "null" ||
			syncSince === "undefined" ||
			!syncSince.trim()
		) {
			syncSince = null;
		}

		loadProgress.value = 0;
		loadingPatients.value = true;
		try {
			try {
				const countResponse = await (frappe.call as any)({
					method: "posawesome.posawesome.api.patient.get_patients_count",
					args: { pos_profile: serializedProfile },
				});
				totalPatientCount.value = countResponse.message || 0;
				logServerPatientCount(totalPatientCount.value);
			} catch (err) {
				console.error("Failed to fetch patient count", err);
				totalPatientCount.value = 0;
			}

			const rows: Patient[] = await fetchPatientPage(
				null,
				syncSince,
				PAGE_SIZE,
			);

			if (rows.length) {
				await setPatientStorage(rows);
			}
			loadedPatientCount.value = rows.length;
			if (totalPatientCount.value) {
				loadProgress.value = Math.min(
					100,
					Math.round(
						(loadedPatientCount.value / totalPatientCount.value) *
							100,
					),
				);
			}
			nextPatientStart.value =
				rows.length === PAGE_SIZE
					? rows[rows.length - 1]?.name || null
					: null;
			if (nextPatientStart.value) {
				backgroundLoadPatients(nextPatientStart.value, syncSince);
			} else {
				setPatientsLastSync(new Date().toISOString());
				loadProgress.value = 100;
				patientsLoaded.value = true;
				logFinalLoadedPatientCount();
			}
			patientsLoaded.value = true;
		} catch (err) {
			console.error("Failed to fetch patients:", err);
		} finally {
			loadingPatients.value = false;
			patientsLoaded.value = true;
			await searchPatients(searchTerm.value);
		}
	}

	async function get_patient_names() {
		if (patientFetchPromise) {
			return patientFetchPromise;
		}

		resetPatientLoadLogState();
		patientFetchPromise = load_patient_names_internal().finally(() => {
			patientFetchPromise = null;
		});
		return patientFetchPromise;
	}

	async function addOrUpdatePatient(patient: Patient) {
		if (!patient || !patient.name) {
			return;
		}
		const existingIndex = patients.value.findIndex(
			(c) => c.name === patient.name,
		);
		if (existingIndex !== -1) {
			const updated = [...patients.value];
			updated.splice(existingIndex, 1, patient);
			patients.value = updated;
		} else {
			patients.value = [...patients.value, patient];
		}
		await setPatientStorage([patient]);
		setSelectedPatient(patient.name);
		requestPatientRefresh();
	}

	async function reloadPatients() {
		if (isOffline()) {
			console.warn("Cannot reload patients while offline");
			return;
		}

		clearLocalState();
		await clearPatientStorage();
		setPatientsLastSync(null);

		await get_patient_names();
	}

	function openUpdatePatientDialog(patient: Patient | null = null) {
		patientToUpdate.value = patient;
		isUpdatePatientDialogOpen.value = true;
	}

	function closeUpdatePatientDialog() {
		isUpdatePatientDialogOpen.value = false;
		patientToUpdate.value = null;
	}

	function clearLocalState() {
		resetPagination();
		selectedPatient.value = null;
		patientInfo.value = {};
		loadProgress.value = 0;
		totalPatientCount.value = 0;
		loadedPatientCount.value = 0;
		patientsLoaded.value = false;
		nextPatientStart.value = null;
		resetPatientLoadLogState();
	}

	return {
		patients,
		filteredPatients,
		selectedPatient,
		patientInfo,
		searchTerm,
		page,
		hasMore,
		nextPatientStart,
		loadingPatients,
		patientsLoaded,
		isPatientBackgroundLoading,
		pendingPatientSearch,
		loadProgress,
		totalPatientCount,
		loadedPatientCount,
		posProfile,
		refreshToken,
		isLoadComplete,
		setPosProfile,
		setSelectedPatient,
		setPatientInfo,
		searchPatients,
		queueSearch,
		loadMorePatients,
		verifyServerPatientCount,
		get_patient_names,
		backgroundLoadPatients,
		addOrUpdatePatient,
		requestPatientRefresh,
		reloadPatients,
		clearLocalState,
		isUpdatePatientDialogOpen,
		patientToUpdate,
		openUpdatePatientDialog,
		closeUpdatePatientDialog,
	};
});
