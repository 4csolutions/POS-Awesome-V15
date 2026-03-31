import { memory, persist, db } from "./db";

type AnyRecord = Record<string, any>;

export function getPatientStorage() {
	return memory.patient_storage || [];
}

export async function getStoredPatient(patientName: string) {
	try {
		const patients = getPatientStorage();
		return patients.find((p) => p.name === patientName) || null;
	} catch (e) {
		console.error("Failed to get stored patient", e);
		return null;
	}
}

export async function setPatientStorage(patients: AnyRecord[]) {
	try {
		const clean = patients.map((p) => ({
			name: p.name,
			patient_name: p.patient_name,
			mobile: p.mobile,
			customer: p.customer,
		}));

		await db.table("patients").bulkPut(clean);
		memory.patient_storage = clean;
		persist("patient_storage");
	} catch (e) {
		console.error("Failed to save patients to storage", e);
	}
}
