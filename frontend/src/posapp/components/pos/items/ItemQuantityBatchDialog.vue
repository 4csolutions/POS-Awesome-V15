<template>
	<v-dialog
		v-model="internalModelValue"
		max-width="550px"
		class="item-quantity-batch-dialog"
	>
		<v-card v-if="item" class="pos-themed-card">
			<v-card-title class="text-h6 pa-4 d-flex align-center">
				<v-icon start color="primary">mdi-cart-plus</v-icon>
				<span>{{ __("Add Item to Cart") }}</span>
				<v-spacer></v-spacer>
				<v-btn icon="mdi-close" variant="text" density="compact" @click="close"></v-btn>
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text class="pa-4">
				<div class="item-info mb-4">
					<div class="text-subtitle-1 font-weight-bold">{{ item.item_name }}</div>
					<div class="text-caption text-medium-emphasis">{{ item.item_code }}</div>
				</div>

				<v-form ref="formRef" @submit.prevent="submit">
					<v-row dense>
						<v-col cols="12">
							<v-label class="mb-1 d-block text-body-2 font-weight-medium">
								{{ __("Quantity") }}
							</v-label>
							<v-text-field
								ref="qtyInput"
								v-model.number="form.qty"
								type="number"
								density="comfortable"
								variant="outlined"
								class="pos-themed-input mb-2"
								:rules="[(v) => v > 0 || __('* Required and must be greater than 0')]"
								@keydown.enter="onQtyEnter"
								autofocus
								:step="hideQtyDecimals ? 1 : 0.001"
							></v-text-field>
						</v-col>

						<v-col cols="12" v-if="item.has_batch_no">
							<v-label class="mb-1 d-block text-body-2 font-weight-medium">
								{{ __("Select Batch") }}
							</v-label>
							
							<v-select
								v-model="form.batch_no"
								:items="batches"
								item-title="batch_no"
								item-value="batch_no"
								density="comfortable"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
								:placeholder="__('Search or select a batch')"
							>
								<template v-slot:item="{ props, item: batchItem }">
									<v-list-item v-bind="props" class="py-2">
										<v-list-item-title class="font-weight-medium">
											{{ batchItem.raw.batch_no }}
										</v-list-item-title>
										<v-list-item-subtitle class="d-flex ga-4">
											<span v-if="batchItem.raw.expiry_date" :class="{ 'text-error': batchItem.raw.is_expired }">
												{{ __("Exp") }}: {{ formatDateDisplay(batchItem.raw.expiry_date) }}
											</span>
											<span>{{ __("Qty") }}: {{ batchItem.raw.available_qty }}</span>
										</v-list-item-subtitle>
									</v-list-item>
								</template>
							</v-select>

							<v-alert
								v-if="batches.length === 0"
								type="warning"
								variant="tonal"
								density="compact"
								class="mt-2"
							>
								{{ __("No available batches found for this item.") }}
							</v-alert>
						</v-col>
					</v-row>
				</v-form>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions class="pa-4">
				<v-btn
					variant="text"
					color="error"
					@click="close"
					:disabled="loading"
				>
					{{ __("Cancel") }}
				</v-btn>
				<v-spacer></v-spacer>
				<v-btn
					color="primary"
					variant="elevated"
					@click="submit"
					:loading="loading"
					:disabled="item.has_batch_no && !form.batch_no"
				>
					{{ __("Add to Cart") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { ref, reactive, watch, computed, nextTick } from "vue";
import { useBatchSerial } from "../../../composables/pos/shared/useBatchSerial";

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	item: {
		type: Object,
		default: null,
	},
	hideQtyDecimals: {
		type: Boolean,
		default: false,
	},
	context: {
		type: Object,
		default: () => ({}),
	}
});

const emit = defineEmits(["update:modelValue", "submit"]);

const __ = (window).__( (text) => text );
const sharedBatchSerial = useBatchSerial();

const formatDateDisplay = (date) => {
	if (!date) return "";
	const parts = String(date).split("-");
	if (parts.length === 3) {
		return `${parts[2]}-${parts[1]}-${parts[0]}`;
	}
	return date;
};

const loading = ref(false);
const formRef = ref(null);
const qtyInput = ref(null);

const form = reactive({
	qty: 1,
	batch_no: "",
});

const internalModelValue = computed({
	get: () => props.modelValue,
	set: (val) => emit("update:modelValue", val),
});

const batches = computed(() => {
	if (!props.item?.has_batch_no) return [];
	// Use shared logic to calculate availability
	return sharedBatchSerial.getBatchAvailability(props.item, props.context).filter(b => b.available_qty > 0);
});

const resetForm = () => {
	form.qty = 1;
	form.batch_no = "";
	
	if (props.item?.has_batch_no && batches.value.length > 0) {
		// Auto-select first available batch if any
		form.batch_no = batches.value[0].batch_no;
	}
	
	nextTick(() => {
		if (qtyInput.value) {
			qtyInput.value.focus();
		}
	});
};

watch(
	() => props.modelValue,
	(val) => {
		if (val) {
			resetForm();
		}
	}
);

const close = () => {
	internalModelValue.value = false;
};

const onQtyEnter = () => {
	if (!props.item?.has_batch_no) {
		submit();
	}
};

const submit = async () => {
	if (!formRef.value) return;

	const { valid } = await formRef.value.validate();
	if (!valid) return;

	if (props.item.has_batch_no && !form.batch_no) {
		return;
	}

	emit("submit", {
		qty: form.qty,
		batch_no: form.batch_no,
	});
	close();
};
</script>

<style scoped>
.batch-list {
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.bg-primary-lighten-5 {
	background-color: var(--v-theme-primary-lighten-5, #f0f7ff);
}
</style>
