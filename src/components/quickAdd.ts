import type { App, BasesPropertyId, EventRef, TFile } from 'obsidian';
import { Notice, normalizePath, parsePropertyId, setIcon } from 'obsidian';
import { QuickAddModal } from '../quickAddModal.ts';
import { CSS_CLASSES, UNCATEGORIZED_LABEL } from '../constants.ts';
import { substituteTokens } from '../utils/template.ts';

export interface QuickAddCtx {
	app: App;
	doc: Document;
	prefsPropertyId: BasesPropertyId | null;
	prefsSwimlanePropertyId: BasesPropertyId | null;
	quickAddFolder: string | null;
	/** Optional template file path used to fill the new note. */
	templateFile: string | null;
}

export interface QuickAddCallbacks {
	createFileForView: (path: string, setFrontmatter?: (fm: Record<string, unknown>) => void) => Promise<void>;
}

const CREATED_CARD_TIMEOUT_MS = 2000;
const CREATED_CARD_SETTLE_MS = 50;

function sanitizeBaseFileName(title: string): string {
	return title
		.trim()
		.replace(/\.md$/i, '')
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/[.\s]+$/g, '')
		.trim();
}

function getWritableFrontmatterPropertyName(propertyId: BasesPropertyId | null): string | null {
	if (!propertyId) return null;
	const parsed = parsePropertyId(propertyId);
	if (parsed.type !== 'note') return null;
	return parsed.name || null;
}

function getCreatedMarkdownFile(app: App, previousPaths: Set<string>, baseFileName: string): TFile | null {
	const createdFiles = app.vault.getMarkdownFiles().filter((file) => !previousPaths.has(file.path));
	if (createdFiles.length === 0) return null;

	const preferredBasename = baseFileName.split('/').pop() ?? baseFileName;
	return createdFiles.find((file) => file.basename === preferredBasename) ?? createdFiles[0] ?? null;
}

function getParentPath(path: string): string {
	const normalizedPath = normalizePath(path);
	const separatorIndex = normalizedPath.lastIndexOf('/');
	return separatorIndex === -1 ? '' : normalizedPath.slice(0, separatorIndex);
}

function isFileInFolder(file: TFile, folder: string): boolean {
	return getParentPath(file.path) === normalizePath(folder);
}

function waitForCreatedMarkdownFile(app: App, previousPaths: Set<string>, baseFileName: string): Promise<TFile | null> {
	if (typeof app.vault.on !== 'function' || typeof app.vault.offref !== 'function') {
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		let eventRef: EventRef | null = null;
		let timeoutId: number | null = null;
		let settled = false;

		const cleanup = () => {
			if (timeoutId !== null) window.clearTimeout(timeoutId);
			if (eventRef) app.vault.offref(eventRef);
		};

		const finish = (file: TFile | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(file);
		};

		const finishIfCreated = () => {
			const createdFile = getCreatedMarkdownFile(app, previousPaths, baseFileName);
			if (createdFile) finish(createdFile);
		};

		eventRef = app.vault.on('create', () => {
			finishIfCreated();
			window.setTimeout(finishIfCreated, CREATED_CARD_SETTLE_MS);
		});
		timeoutId = window.setTimeout(() => {
			finish(getCreatedMarkdownFile(app, previousPaths, baseFileName));
		}, CREATED_CARD_TIMEOUT_MS);
	});
}

function getAvailablePath(app: App, folder: string, fileName: string): string {
	const extension = fileName.toLowerCase().endsWith('.md') ? '.md' : '';
	const basename = extension ? fileName.slice(0, -extension.length) : fileName;
	let candidate = normalizePath(`${folder}/${extension ? fileName : `${fileName}.md`}`);
	let counter = 1;

	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${folder}/${basename} ${counter}.md`);
		counter++;
	}

	return candidate;
}

function getCreatePath(baseFileName: string, folder: string | null): string {
	return normalizePath(folder ? `${folder}/${baseFileName}` : baseFileName);
}

function isEmptyFrontmatterValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

function getActiveFrontmatter(app: App): Record<string, unknown> | null {
	const activeFile = app.workspace?.getActiveFile?.();
	if (!activeFile) return null;
	const cache = app.metadataCache?.getFileCache?.(activeFile);
	const frontmatter = cache?.frontmatter;
	return frontmatter && typeof frontmatter === 'object' ? frontmatter : null;
}

function formatCreatedAt(date: Date): string {
	return substituteTokens('{{DATE:YYYY-MM-DDTHH:mm:ss}}', {
		title: '',
		column: '',
		now: date,
	});
}

function applyInheritedFrontmatter(
	frontmatter: Record<string, unknown>,
	activeFrontmatter: Record<string, unknown> | null,
): void {
	if (!activeFrontmatter) return;
	if (isEmptyFrontmatterValue(frontmatter.Areas) && !isEmptyFrontmatterValue(activeFrontmatter.Areas)) {
		frontmatter.Areas = activeFrontmatter.Areas;
	}
}

async function ensureCreatedCardInFolder(
	app: App,
	previousPaths: Set<string>,
	createdFilePromise: Promise<TFile | null>,
	baseFileName: string,
	folder: string,
): Promise<TFile | null> {
	const createdFile = getCreatedMarkdownFile(app, previousPaths, baseFileName) ?? (await createdFilePromise);
	if (!createdFile) {
		new Notice(`Created card, but could not move it to ${folder}.`);
		return null;
	}

	if (isFileInFolder(createdFile, folder)) return createdFile;

	const targetPath = getAvailablePath(app, folder, baseFileName);
	if (targetPath === createdFile.path) return createdFile;

	await app.fileManager.renameFile(createdFile, targetPath);
	return createdFile;
}

export function closeNativeNewItemPopover(doc: Document): void {
	const closePopovers = () => {
		const popovers = Array.from(doc.querySelectorAll<HTMLElement>('.bases-new-item-popover'));
		if (popovers.length === 0) return;
		doc.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		doc.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		popovers.forEach((popover) => {
			popover.remove();
		});
	};

	closePopovers();
	window.requestAnimationFrame(closePopovers);
	for (const delay of [50, 250, 1000]) {
		window.setTimeout(closePopovers, delay);
	}
}

export async function createQuickAddCard(
	title: string,
	columnValue: string,
	swimlaneValue: string | null,
	ctx: QuickAddCtx,
	cb: QuickAddCallbacks,
): Promise<void> {
	const baseFileName = sanitizeBaseFileName(title);
	if (!baseFileName) {
		new Notice('Enter a card title.');
		return;
	}

	const columnPropertyName = getWritableFrontmatterPropertyName(ctx.prefsPropertyId);
	if (!columnPropertyName) {
		new Notice('Quick add needs a writable note property for columns.');
		return;
	}

	const swimlanePropertyName = swimlaneValue ? getWritableFrontmatterPropertyName(ctx.prefsSwimlanePropertyId) : null;
	if (swimlaneValue && !swimlanePropertyName) {
		new Notice('Quick add needs a writable note property for swimlanes.');
		return;
	}

	const targetFolder = ctx.quickAddFolder;
	if (targetFolder && !ctx.app?.vault.getFolderByPath(targetFolder)) {
		new Notice(`Quick add folder not found: ${targetFolder}`);
		return;
	}

	// Resolve the template up-front so a bad path surfaces before we create anything.
	let templateRaw: string | null = null;
	if (ctx.templateFile) {
		const templateTFile = ctx.app.vault.getFileByPath(normalizePath(ctx.templateFile));
		if (!templateTFile) {
			new Notice(`Template not found: ${ctx.templateFile}`);
		} else {
			try {
				templateRaw = await ctx.app.vault.read(templateTFile);
			} catch (error) {
				console.error('Error reading template file:', error);
				new Notice('Could not read template file.');
			}
		}
	}

	const fileNameToCreate = getCreatePath(baseFileName, targetFolder);
	const createdFilePaths = new Set(ctx.app.vault.getMarkdownFiles().map((file) => file.path));
	const createdFilePromise = waitForCreatedMarkdownFile(ctx.app, createdFilePaths, fileNameToCreate);
	const activeFrontmatter = getActiveFrontmatter(ctx.app);
	const createdAt = formatCreatedAt(new Date());

	// Force the dragged-into column (and swimlane) onto the note's frontmatter.
	// This runs after any template body is written, so it always wins.
	const setFrontmatter = (frontmatter: Record<string, unknown>): void => {
		if (templateRaw !== null && isEmptyFrontmatterValue(frontmatter.CreatedAt)) {
			frontmatter.CreatedAt = createdAt;
		}

		applyInheritedFrontmatter(frontmatter, activeFrontmatter);

		if (columnValue === UNCATEGORIZED_LABEL) {
			delete frontmatter[columnPropertyName];
		} else {
			frontmatter[columnPropertyName] = columnValue;
		}

		if (!swimlaneValue || !swimlanePropertyName) return;
		if (swimlaneValue === UNCATEGORIZED_LABEL) {
			delete frontmatter[swimlanePropertyName];
		} else {
			frontmatter[swimlanePropertyName] = swimlaneValue;
		}
	};

	let createdFrontmatter: Record<string, unknown> = {};
	const captureViewFrontmatter = (frontmatter: Record<string, unknown>): void => {
		setFrontmatter(frontmatter);
		createdFrontmatter = { ...frontmatter };
	};

	try {
		// Always let Bases prepare the note first. Its filters can add context
		// properties such as Project/Areas, which we re-apply after templating.
		await cb.createFileForView(fileNameToCreate, captureViewFrontmatter);
		closeNativeNewItemPopover(ctx.doc);
		const createdFile = targetFolder
			? await ensureCreatedCardInFolder(ctx.app, createdFilePaths, createdFilePromise, baseFileName, targetFolder)
			: (getCreatedMarkdownFile(ctx.app, createdFilePaths, baseFileName) ?? (await createdFilePromise));

		if (createdFile && templateRaw !== null) {
			const content = substituteTokens(templateRaw, {
				title: baseFileName,
				column: columnValue === UNCATEGORIZED_LABEL ? '' : columnValue,
				now: new Date(),
			});
			await ctx.app.vault.modify(createdFile, content);
			// Override template frontmatter with the view-derived context, then force
			// the selected column/swimlane so every + button behaves the same way.
			await ctx.app.fileManager.processFrontMatter(createdFile, (frontmatter: Record<string, unknown>) => {
				Object.assign(frontmatter, createdFrontmatter);
				setFrontmatter(frontmatter);
			});
		}
	} catch (error) {
		console.error('Error creating kanban card:', error);
		new Notice('Could not create card.');
	}
}

export function createAddButton(
	columnValue: string,
	swimlaneValue: string | null,
	ctx: QuickAddCtx,
	cb: QuickAddCallbacks,
): HTMLElement {
	const btn = ctx.doc.createElement('div');
	btn.className = CSS_CLASSES.COLUMN_ADD_BTN;
	btn.setAttribute(
		'aria-label',
		swimlaneValue ? `Add card to column: ${columnValue} in lane: ${swimlaneValue}` : `Add card to column: ${columnValue}`,
	);
	btn.setAttribute('role', 'button');
	btn.setAttribute('tabindex', '0');
	setIcon(btn, 'plus');

	const open = () => {
		if (!ctx.app) return;
		new QuickAddModal(ctx.app, {
			columnValue,
			swimlaneValue,
			onSubmit: (title) => createQuickAddCard(title, columnValue, swimlaneValue, ctx, cb),
		}).open();
	};

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		open();
	});
	btn.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		e.stopPropagation();
		open();
	});
	return btn;
}
