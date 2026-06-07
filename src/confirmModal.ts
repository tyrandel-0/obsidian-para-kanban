import type { App } from 'obsidian';
import { Modal } from 'obsidian';

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
}

/** Small yes/no confirmation dialog used before destructive card actions. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: ConfirmModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.contentEl.createEl('p', { text: this.options.message });

		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancelBtn = actions.createEl('button', {
			text: this.options.cancelText ?? 'Cancel',
			attr: { type: 'button' },
		});
		const confirmBtn = actions.createEl('button', {
			text: this.options.confirmText ?? 'Delete',
			cls: this.options.destructive === false ? 'mod-cta' : 'mod-warning',
			attr: { type: 'button' },
		});

		cancelBtn.addEventListener('click', () => this.close());
		confirmBtn.addEventListener('click', () => {
			this.close();
			void Promise.resolve(this.options.onConfirm());
		});

		window.requestAnimationFrame(() => confirmBtn.focus());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
