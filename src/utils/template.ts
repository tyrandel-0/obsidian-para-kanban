/**
 * Lightweight templating for the "+" quick-add flow.
 *
 * Supports a small, self-contained token set so the plugin can fill a template
 * file without depending on Templater or QuickAdd. Tokens are case-insensitive:
 *
 *   {{title}} / {{value}}   → the card title the user typed
 *   {{column}}              → the column value the card was created in
 *   {{date}}               → current date, YYYY-MM-DD
 *   {{date:FORMAT}}         → current date with a custom format (see formatDate)
 *   {{time}}               → current time, HH:mm
 *   {{time:FORMAT}}         → current time with a custom format
 *   {{value:NAME}}          → empty string (interactive prompts are not supported here)
 *
 * Any other {{...}} token is left untouched (Bases expressions like
 * `this.file.asLink()` are not wrapped in {{}} and are therefore never matched).
 */

export interface TemplateTokenCtx {
	title: string;
	column: string;
	now: Date;
}

const DATE_FORMAT_RE = /YYYY|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g;

function pad(n: number, len = 2): string {
	return String(n).padStart(len, '0');
}

/**
 * Minimal date formatter covering the tokens used in this vault's templates.
 * Not a full moment.js — just the common pieces.
 */
export function formatDate(date: Date, fmt: string): string {
	const hours24 = date.getHours();
	const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
	const map: Record<string, string> = {
		YYYY: String(date.getFullYear()),
		YY: pad(date.getFullYear() % 100),
		MM: pad(date.getMonth() + 1),
		M: String(date.getMonth() + 1),
		DD: pad(date.getDate()),
		D: String(date.getDate()),
		HH: pad(hours24),
		H: String(hours24),
		hh: pad(hours12),
		h: String(hours12),
		mm: pad(date.getMinutes()),
		m: String(date.getMinutes()),
		ss: pad(date.getSeconds()),
		s: String(date.getSeconds()),
		A: hours24 < 12 ? 'AM' : 'PM',
		a: hours24 < 12 ? 'am' : 'pm',
	};
	return fmt.replace(DATE_FORMAT_RE, (token) => map[token] ?? token);
}

function resolveToken(raw: string, ctx: TemplateTokenCtx): string | null {
	const token = raw.trim();
	const lower = token.toLowerCase();

	if (lower === 'title' || lower === 'value') return ctx.title;
	if (lower === 'column') return ctx.column;
	if (lower === 'date') return formatDate(ctx.now, 'YYYY-MM-DD');
	if (lower === 'time') return formatDate(ctx.now, 'HH:mm');
	if (lower.startsWith('date:')) return formatDate(ctx.now, token.slice(5).trim());
	if (lower.startsWith('time:')) return formatDate(ctx.now, token.slice(5).trim());
	// Interactive QuickAdd-style prompts (e.g. {{VALUE:project}}) have no input
	// here — collapse them to empty so they don't leak into the note.
	if (lower.startsWith('value:')) return '';

	// Unknown token: leave it exactly as written.
	return null;
}

export function substituteTokens(text: string, ctx: TemplateTokenCtx): string {
	return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, inner: string) => {
		const resolved = resolveToken(inner, ctx);
		return resolved === null ? match : resolved;
	});
}
