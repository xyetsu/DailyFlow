import { App, TFile, moment, FuzzySuggestModal, Notice } from "obsidian";
import DailyLogPlugin from "./main";

// --- Helpers (Suggest Modal) ---
class TagSuggest extends FuzzySuggestModal<string> {
	items: string[];
	inputEl: HTMLInputElement;
	constructor(app: App, items: string[], inputEl: HTMLInputElement) {
		super(app);
		this.items = items;
		this.inputEl = inputEl;
	}
	getItems() {
		return this.items;
	}
	getItemText(item: string) {
		return `#${item}`;
	}
	onChooseItem(item: string) {
		const el = this.inputEl;
		const val = el.value;
		const caret = el.selectionStart ?? val.length;
		const prefix = val.slice(0, caret);
		const lastHash = prefix.lastIndexOf("#");
		const before = val.slice(0, lastHash >= 0 ? lastHash : 0);
		const after = val.slice(caret);
		el.value = `${before}#${item}${after}`;
		const pos = (before + "#" + item).length;
		el.setSelectionRange(pos, pos);
		el.focus();
	}
}

class FileLinkSuggest extends FuzzySuggestModal<TFile> {
	items: TFile[];
	inputEl: HTMLInputElement;
	constructor(app: App, files: TFile[], inputEl: HTMLInputElement) {
		super(app);
		this.items = files;
		this.inputEl = inputEl;
	}
	getItems() {
		return this.items;
	}
	getItemText(f: TFile) {
		return f.basename || f.path;
	}
	onChooseItem(f: TFile) {
		const el = this.inputEl;
		const val = el.value;
		const caret = el.selectionStart ?? val.length;
		const before = val.slice(0, caret);
		const idx = before.lastIndexOf("[[");
		const pre = val.slice(0, idx >= 0 ? idx : 0);
		const after = val.slice(caret);
		const insertion = `[[${f.path}]]`;
		el.value = `${pre}${insertion}${after}`;
		const pos = (pre + insertion).length;
		el.setSelectionRange(pos, pos);
		el.focus();
	}
}

type EventModel = {
	idx: number;
	raw: string;
	key: string;
	body: string;
	entryTime: string | null;
	recordedTime: string | null;
	text: string;
};

export class DailyLogEmbed {
	plugin: DailyLogPlugin;
	app: App;
	containerEl: HTMLElement;
	currentDate: string;

	// --- Состояние инициализации ---
	private isInitialized = false;

	// --- Ссылки на контейнеры ---
	private habitsContainer: HTMLElement | null = null;
	private logListContainer: HTMLElement | null = null;

	// --- Ссылки на элементы формы (чтобы не терять фокус) ---
	private timeInputEl: HTMLInputElement | null = null;
	private textInputEl: HTMLInputElement | null = null;
	private dateInputEl: HTMLInputElement | null = null;

	// --- Overlay refs ---
	private editOverlayEl: HTMLElement | null = null;
	private _ksDropdownEl?: HTMLElement | null;
	private _ksDropdownReposition?: () => void;
	private _ksDropdownDocClick?: (ev: Event) => void;

	constructor(el: HTMLElement, plugin: DailyLogPlugin, currentDate: string) {
		this.containerEl = el;
		this.plugin = plugin;
		this.app = plugin.app;
		this.currentDate = currentDate;

		if (!this.containerEl.style.position)
			this.containerEl.style.position = "relative";
		this.containerEl.addClass("df-container");

		// Оптимизированный слушатель изменений
		let _modifyTimer: number | null = null;
		this.plugin.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!file || typeof (file as any).path !== "string") return;
				if (file.path !== this.getFilePath()) return;

				if (_modifyTimer !== null) window.clearTimeout(_modifyTimer);
				_modifyTimer = window.setTimeout(() => {
					_modifyTimer = null;
					// Вызываем ОБНОВЛЕНИЕ ДАННЫХ (refreshData), а не render (который строит каркас)
					this.refreshData();
				}, 50);
			})
		);
	}

	getFolder() {
		return `Журнал/Ежедневные/${this.currentDate.slice(
			0,
			4
		)}/${this.currentDate.slice(5, 7)}`;
	}

	getFilePath() {
		return `${this.getFolder()}/${this.currentDate}.md`;
	}

	async getFileOrNull(): Promise<TFile | null> {
		return (
			(this.app.vault.getAbstractFileByPath(
				this.getFilePath()
			) as TFile) || null
		);
	}

	normalizeKey(k: string) {
		return k ? k.replace(/::\s*$/, "") : k;
	}
	escapeHtml(s: string) {
		if (!s) return "";
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	// ============================================================
	// ГЛАВНЫЙ ЦИКЛ РЕНДЕРА (ОПТИМИЗИРОВАННЫЙ)
	// ============================================================
	async render() {
		this.closeEditOverlay();

		// 1. Если каркас еще не создан — создаем его.
		// Это происходит только один раз при открытии заметки.
		if (!this.isInitialized) {
			this.buildLayoutStructure();
			this.isInitialized = true;
		}

		// 2. Обновляем данные (список и галочки).
		// Это происходит при каждом изменении файла.
		await this.refreshData();
	}

	// Создаем HTML-каркас один раз
	buildLayoutStructure() {
		this.containerEl.empty();

		// A. Контейнер привычек
		this.habitsContainer = this.containerEl.createEl("div", {
			cls: "df-habits-list",
		});

		// B. Разделитель
		this.createDivider();

		// C. Контейнер списка событий
		this.logListContainer = this.containerEl.createEl("ul", {
			cls: "df-log-list",
		});
		this.logListContainer.style.position = "relative";

		// D. Форма ввода (внизу) — создается один раз, фокус не теряется
		this.createInputForm();

		// E. Навигация по датам
		this.createDateNavigationBlock();
	}

	createDivider() {
		const divContainer = this.containerEl.createEl("div", {
			cls: "df-divider",
		});
		divContainer.createEl("span", {
			cls: "df-divider-label",
			text: "day log",
		});
		divContainer.createEl("div", { cls: "df-divider-line" });
	}

	// Обновление данных внутри каркаса
	async refreshData() {
		const file = await this.getFileOrNull();

		if (!file) {
			if (this.logListContainer) {
				this.logListContainer.empty();
				const msg = this.logListContainer.createEl("li", {
					cls: "df-msg-empty",
				});
				msg.createSpan({
					text: `Заметка ${this.currentDate} не найдена.`,
				});
			}
			if (this.habitsContainer) this.habitsContainer.empty();
			return;
		}

		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);

		// Обновляем привычки
		if (this.habitsContainer) {
			this.updateHabitsUI(file, cache?.frontmatter);
		}

		// Обновляем список (перерисовываем только строки списка)
		if (this.logListContainer) {
			this.updateLogListUI(content, file);
		}
	}

	// ============================================================
	// UI UPDATERS
	// ============================================================

	updateHabitsUI(file: TFile, frontmatter: any) {
		this.habitsContainer!.empty();

		this.plugin.settings.habits.forEach((habit) => {
			const row = this.habitsContainer!.createEl("div", {
				cls: "df-habit-row",
			});
			const left = row.createEl("div", { cls: "df-habit-label" });
			left.innerHTML = `${habit.iconSvg} ${habit.key}`;

			const val = frontmatter ? frontmatter[habit.key] : null;

			if (habit.type === "checkbox") {
				const cb = row.createEl("input", { type: "checkbox" });
				cb.addClass("df-habit-checkbox");
				(cb as HTMLInputElement).checked = val === true;
				cb.onchange = async () => {
					await this.updateFrontmatter(
						file,
						habit.key,
						(cb as HTMLInputElement).checked
					);
					// render не нужен, сработает watcher
				};
			} else {
				const inp = row.createEl("input", {
					type: habit.type === "number" ? "number" : "text",
				});
				inp.addClass("df-habit-input");
				(inp as HTMLInputElement).value =
					val !== undefined ? String(val) : "";
				inp.onblur = async () => {
					const newVal = (inp as HTMLInputElement).value;
					if (newVal != (val !== undefined ? String(val) : "")) {
						const saveVal =
							habit.type === "number" ? Number(newVal) : newVal;
						await this.updateFrontmatter(file, habit.key, saveVal);
					}
				};
			}
		});
	}

	updateLogListUI(content: string, file: TFile) {
		this.logListContainer!.empty();

		const lines = content.split("\n");
		const events: EventModel[] = [];
		for (let i = 0; i < lines.length; i++) {
			const ev = this.parseEventLine(lines[i], i);
			if (ev) events.push(ev);
		}

		const iconMap: Record<string, string> = {};
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			iconMap[norm] = k.iconSvg || "";
		});

		events.forEach((ev, posIndex) => {
			const li = this.renderEventCard(ev, iconMap, posIndex, file);
			this.logListContainer!.appendChild(li);
		});
	}

	createInputForm() {
		const form = this.containerEl.createEl("form", {
			cls: "df-input-form",
		});

		// Time Input
		this.timeInputEl = form.createEl("input", {
			type: "time",
		}) as HTMLInputElement;
		this.timeInputEl.addClass("df-input-time");

		// Text Input
		this.textInputEl = form.createEl("input", {
			type: "text",
			placeholder: "Событие...",
		}) as HTMLInputElement;
		this.textInputEl.addClass("df-input-text");
		this.attachSuggestHandlers(this.textInputEl);

		// Key Selector
		const keySelector = document.createElement("div");
		keySelector.className = "df-key-selector";

		const ksButton = document.createElement("button");
		ksButton.type = "button";
		ksButton.className = "ks-button";
		ksButton.tabIndex = 0;

		const options = this.plugin.settings.logKeys.map((k) => ({
			key: this.normalizeKey(k.key),
			icon: k.iconSvg || "",
		}));
		let selectedKey = options[0] ? options[0].key : "";

		const updateKsButton = () => {
			const found = options.find((o) => o.key === selectedKey);
			if (found) {
				ksButton.innerHTML = found.icon
					? found.icon
					: this.escapeHtml(found.key.charAt(0));
				ksButton.title = found.key;
			}
		};
		updateKsButton();

		// Dropdown logic
		const ksDropdown = document.createElement("ul");
		ksDropdown.className = "ks-dropdown";
		ksDropdown.style.position = "fixed";
		ksDropdown.style.zIndex = "10060";

		options.forEach((opt) => {
			const li = document.createElement("li");
			li.className = "ks-option";
			li.innerHTML = `${opt.icon} ${this.escapeHtml(opt.key)}`;
			li.onclick = (e) => {
				e.preventDefault();
				selectedKey = opt.key;
				updateKsButton();
				try {
					ksDropdown.remove();
				} catch (e) {}
			};
			ksDropdown.appendChild(li);
		});

		ksButton.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = ksButton.getBoundingClientRect();
			ksDropdown.style.top = `${rect.bottom + 5}px`;
			ksDropdown.style.left = `${rect.left}px`;
			document.body.appendChild(ksDropdown);

			const close = () => {
				try {
					ksDropdown.remove();
				} catch (e) {}
				document.removeEventListener("click", close);
			};
			document.addEventListener("click", close);
		};

		keySelector.appendChild(ksButton);
		form.appendChild(keySelector);

		// Submit Handler
		form.onsubmit = async (e) => {
			e.preventDefault();
			const prefix = selectedKey;
			const timeVal = this.timeInputEl!.value;
			const textVal = this.textInputEl!.value;

			// Мгновенная очистка для отзывчивости
			this.textInputEl!.value = "";
			this.timeInputEl!.value = "";

			await this.addEntry(prefix, timeVal, textVal);
			// Фокус возвращается в поле ввода
			this.textInputEl!.focus();
		};
	}

	createDateNavigationBlock() {
		const dateBlock = this.containerEl.createEl("div", {
			cls: "df-date-block",
		});

		this.dateInputEl = dateBlock.createEl("input", {
			type: "date",
			cls: "df-date-input",
		}) as HTMLInputElement;
		this.dateInputEl.value =
			this.currentDate || moment().format("YYYY-MM-DD");
		this.dateInputEl.onchange = () => {
			this.currentDate = this.dateInputEl!.value;
			this.refreshData();
		};

		const prevBtn = dateBlock.createEl("button", {
			text: "←",
			cls: "df-nav-btn",
		});
		prevBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.subtract(1, "day")
				.format("YYYY-MM-DD");
			if (this.dateInputEl) this.dateInputEl.value = this.currentDate;
			this.refreshData();
		};

		const nextBtn = dateBlock.createEl("button", {
			text: "→",
			cls: "df-nav-btn",
		});
		nextBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.add(1, "day")
				.format("YYYY-MM-DD");
			if (this.dateInputEl) this.dateInputEl.value = this.currentDate;
			this.refreshData();
		};

		const rightControls = dateBlock.createEl("div", {
			cls: "df-date-right-controls",
		});

		// NOW Button
		const nowBtn = rightControls.createEl("button", {
			text: "Сейчас",
			cls: "df-nav-btn df-now-btn",
		});
		nowBtn.onclick = async (e) => {
			e.preventDefault();
			const prefix =
				(this.containerEl.querySelector(".ks-button") as HTMLElement)
					?.title || "";
			const now = moment().format("HH:mm");
			const txt = this.textInputEl!.value;
			this.textInputEl!.value = "";
			await this.addEntryNoRecorded(prefix, now, txt);
		};

		// Add Button
		const addBtn = rightControls.createEl("button", {
			text: "Добавить",
			cls: "df-nav-btn df-add-btn",
		});
		addBtn.onclick = (e) => {
			e.preventDefault();
			// Триггерим сабмит формы
			this.containerEl
				.querySelector("form.df-input-form")
				?.dispatchEvent(new Event("submit"));
		};
	}

	// ---------- Parsing & Utils ----------

	async updateFrontmatter(file: TFile, key: string, value: any) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}

	parseEventLine(line: string, idx: number): EventModel | null {
		const anchoredRe = /^(.+?)::\s*(.*)$/;
		let m = line.match(anchoredRe);
		let keyRaw: string | null = null;
		let rawBody = "";

		if (m) {
			keyRaw = m[1].trim();
			rawBody = (m[2] || "").trim();
		} else {
			const pos = line.indexOf("::");
			if (pos === -1) return null;
			const left = line.slice(0, pos).trim();
			const right = line.slice(pos + 2).trim();
			if (!left) return null;
			const leftTokens = left.split(/\s+/);
			keyRaw = leftTokens[leftTokens.length - 1] || null;
			if (!keyRaw) return null;
			rawBody = right;
		}

		const key = keyRaw ? this.normalizeKey(keyRaw) : "";
		let entryTime: string | null = null;
		let recordedTime: string | null = null;
		let text = rawBody;

		const trailing = text.match(/\s*\((\d{1,2}:\d{2})\)\s*$/);
		if (trailing) {
			recordedTime = trailing[1];
			text = text.substring(0, trailing.index).trim();
		}

		const leading = text.match(
			/^(?:\(?\s*(\d{1,2}:\d{2})\s*\)?)(?:[\-\.\s]+)?(.*)$/
		);
		if (leading) {
			entryTime = leading[1];
			text = (leading[2] || "").trim();
		}

		return {
			idx,
			raw: line,
			key,
			body: rawBody,
			entryTime,
			recordedTime,
			text,
		};
	}

	attachSuggestHandlers(inputEl: HTMLInputElement) {
		const tagsObj: Record<string, any> = (this.app.metadataCache as any)
			.getTags
			? (this.app.metadataCache as any).getTags()
			: {};
		const tags = Object.keys(tagsObj || {}).map((t) => t.replace(/^#/, ""));
		const files: TFile[] = (this.app.vault as any).getMarkdownFiles
			? (this.app.vault as any).getMarkdownFiles()
			: (this.app.vault as any).getFiles();

		inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "#") {
				new TagSuggest(this.app, tags, inputEl).open();
			} else if (e.key === "[") {
				const val = inputEl.value;
				const caret = inputEl.selectionStart ?? val.length;
				if (caret >= 1 && val[caret - 1] === "[") {
					new FileLinkSuggest(this.app, files, inputEl).open();
				}
			}
		});
	}

	parseInlineMarkup(text: string): DocumentFragment {
		const frag = document.createDocumentFragment();
		if (!text) return frag;
		const pattern = /(\[\[[^\]]+\]\]|#[\w\u0400-\u04FF\-]+|\d{1,2}:\d{2})/g;
		let lastIdx = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			if (m.index > lastIdx) {
				frag.appendChild(
					document.createTextNode(text.slice(lastIdx, m.index))
				);
			}
			const token = m[0];
			if (token.startsWith("[[")) {
				const inner = token.slice(2, -2);
				const parts = inner.split("|");
				const linkpath = parts[0].trim();
				const alias = (parts[1] || parts[0]).trim();
				const a = document.createElement("a");
				a.className = "internal-link";
				a.setAttribute("data-href", linkpath);
				a.textContent = alias;
				frag.appendChild(a);
			} else if (token.startsWith("#")) {
				const tag = token.slice(1);
				const a = document.createElement("a");
				a.className = "tag";
				a.setAttribute("href", `#${tag}`);
				a.textContent = `#${tag}`;
				a.setAttribute("data-tag", tag);
				frag.appendChild(a);
			} else if (/^\d{1,2}:\d{2}$/.test(token)) {
				const span = document.createElement("span");
				span.className = "df-time-inline";
				span.textContent = token;
				frag.appendChild(span);
			} else {
				frag.appendChild(document.createTextNode(token));
			}
			lastIdx = pattern.lastIndex;
		}
		if (lastIdx < text.length)
			frag.appendChild(document.createTextNode(text.slice(lastIdx)));
		return frag;
	}

	// ---------- Actions ----------
	// ИСПРАВЛЕНЫ ИМЕНА ПЕРЕМЕННЫХ И АРГУМЕНТОВ НИЖЕ

	async addEntry(prefix: string, time: string, text: string) {
		// [ИСПРАВЛЕНИЕ] Добавить проверку на пустую строку
		if (!text.trim()) {
			new Notice("Текст события не может быть пустым.");
			this.textInputEl!.focus(); // Возвращаем фокус
			return;
		}

		const file = await this.getFileOrNull();
		if (!file) return;

		const tagMatch = text.match(/#([^\s#]+)/);
		if (tagMatch) {
			const tag = tagMatch[1];
			const mapped = this.plugin.settings.logKeys.find((k: any) => {
				if (!k.tags) return false;
				if (typeof k.tags === "string") return k.tags === tag;
				if (Array.isArray(k.tags)) return k.tags.includes(tag);
				return false;
			});
			if (mapped) {
				prefix = this.normalizeKey(mapped.key);
				text = text.replace(new RegExp(`#${tag}\\b`, "g"), "").trim();
			}
		}

		const entryTime = time ? time : "";
		const recordedTime = moment().format("HH:mm");
		const line = `${prefix}:: ${entryTime}${
			entryTime ? " " : ""
		}${text.trim()} (${recordedTime})`.trim(); // [ИСПРАВЛЕНИЕ] Использование text.trim() в финальной строке

		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async addEntryNoRecorded(prefix: string, time: string, text: string) {
		// [ИСПРАВЛЕНИЕ] Добавить проверку на пустую строку
		if (!text.trim()) {
			new Notice("Текст события не может быть пустым.");
			this.textInputEl!.focus(); // Возвращаем фокус
			return;
		}

		const file = await this.getFileOrNull();
		if (!file) return;

		const tagMatch = text.match(/#([^\s#]+)/);
		if (tagMatch) {
			const tag = tagMatch[1];
			const mapped = this.plugin.settings.logKeys.find((k: any) => {
				if (!k.tags) return false;
				if (typeof k.tags === "string") return k.tags === tag;
				if (Array.isArray(k.tags)) return k.tags.includes(tag);
				return false;
			});
			if (mapped) {
				prefix = this.normalizeKey(mapped.key);
				text = text.replace(new RegExp(`#${tag}\\b`, "g"), "").trim();
			}
		}

		const entryTime = time ? time : "";
		const line = `${prefix}:: ${entryTime}${
			entryTime ? " " : ""
		}${text.trim()}`.trim(); // [ИСПРАВЛЕНИЕ] Использование text.trim() в финальной строке

		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async updateEventLine(file: TFile, lineIdx: number, newLine: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines[lineIdx] = newLine;
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async removeEventLine(file: TFile, lineIdx: number) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines.splice(lineIdx, 1);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async reorderEventLines(
		file: TFile,
		srcLineIdx: number,
		destLineIdx: number
	) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const eventRe = /^(.+?)::\s*(.*)$/;

		const eventIndices: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (eventRe.test(lines[i].trim())) eventIndices.push(i);
		}

		const srcPos = eventIndices.indexOf(srcLineIdx);
		const destPos = eventIndices.indexOf(destLineIdx);
		if (srcPos === -1 || destPos === -1) return;

		const newOrder = [...eventIndices];
		const [moved] = newOrder.splice(srcPos, 1);
		newOrder.splice(destPos, 0, moved);

		const newEventLines = newOrder.map((i) => lines[i]);

		const out = [...lines];
		for (let k = 0; k < eventIndices.length; k++) {
			out[eventIndices[k]] = newEventLines[k];
		}

		await this.app.vault.modify(file, out.join("\n"));
	}

	// ---------- Render Single Event ----------
	renderEventCard(
		ev: EventModel,
		iconMap: Record<string, string>,
		posIndex: number,
		file: TFile
	) {
		const li = document.createElement("li");
		li.className = "df-event-card";
		li.setAttribute("data-file-line-idx", String(ev.idx));
		li.setAttribute("data-event-pos", String(posIndex));

		// left wrapper
		const leftWrap = document.createElement("div");
		leftWrap.className = "df-event-left";
		leftWrap.style.position = "relative";

		// drag handle
		const handle = document.createElement("span");
		handle.className = "df-drag-handle";
		handle.textContent = "⋮";
		handle.setAttribute("draggable", "true");
		leftWrap.appendChild(handle);

		const textDiv = document.createElement("div");
		textDiv.className = "df-event-text";

		let bodyWithoutRecorded = ev.body || "";
		bodyWithoutRecorded = bodyWithoutRecorded
			.replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, "")
			.trim();

		textDiv.innerHTML = "";
		const frag = this.parseInlineMarkup(bodyWithoutRecorded);
		textDiv.appendChild(frag);
		textDiv.style.display = "inline-block";
		leftWrap.appendChild(textDiv);
		li.appendChild(leftWrap);

		// Right: meta + controls
		const rightDiv = document.createElement("div");
		rightDiv.className = "df-event-meta";
		rightDiv.style.marginLeft = "auto";

		const metaGroup = document.createElement("div");
		metaGroup.className = "df-meta-group";

		if (ev.recordedTime) {
			const rec = document.createElement("span");
			rec.className = "df-recorded-time";
			rec.textContent = this.escapeHtml(ev.recordedTime);
			metaGroup.appendChild(rec);
		}

		if (ev.key !== "dl") {
			const badge = document.createElement("div");
			badge.className = "df-key-badge";
			const icon = iconMap[ev.key] || "";
			if (icon) {
				const spanI = document.createElement("span");
				spanI.className = "df-key-icon";
				spanI.innerHTML = icon;
				badge.appendChild(spanI);
			}
			const spanKey = document.createElement("span");
			spanKey.textContent = ev.key;
			badge.appendChild(spanKey);
			metaGroup.appendChild(badge);
		}

		rightDiv.appendChild(metaGroup);

		// Controls
		const controls = document.createElement("div");
		controls.className = "df-event-controls";
		const editBtn = document.createElement("button");
		editBtn.className = "df-control-btn df-edit-btn";
		editBtn.innerHTML = this.plugin.settings.icons?.hoverEdit || "✎"; // Use SVG from settings if available
		controls.appendChild(editBtn);
		rightDiv.appendChild(controls);

		li.appendChild(rightDiv);

		// Drag & drop handlers
		handle.addEventListener("dragstart", (e) => {
			e.dataTransfer!.setData("text/plain", String(ev.idx));
			li.classList.add("is-dragging");
		});
		li.addEventListener("dragend", () => {
			li.classList.remove("is-dragging");
			this.containerEl
				.querySelectorAll(".drag-over")
				.forEach((el) => el.classList.remove("drag-over"));
		});
		li.addEventListener("dragover", (e) => {
			e.preventDefault();
			li.classList.add("drag-over");
		});
		li.addEventListener("dragleave", () =>
			li.classList.remove("drag-over")
		);
		li.addEventListener("drop", async (e) => {
			e.preventDefault();
			li.classList.remove("drag-over");
			const srcIdxStr = e.dataTransfer!.getData("text/plain");
			const srcLineIdx = Number(srcIdxStr);
			const dstLineIdx = ev.idx;
			if (isNaN(srcLineIdx) || srcLineIdx === dstLineIdx) return;
			await this.reorderEventLines(file, srcLineIdx, dstLineIdx);
		});

		editBtn.onclick = () => {
			this.openEditOverlay(li, file, ev);
		};

		return li;
	}

	async showConfirmDialog(msg: string) {
		return confirm(msg);
	}

	openEditOverlay(li: HTMLElement, file: TFile, ev: EventModel) {
		this.closeEditOverlay();
		li.classList.add("df-editing-hidden");

		const overlay = document.createElement("div");
		overlay.className = "df-edit-overlay";
		overlay.style.position = "absolute";
		overlay.style.boxSizing = "border-box";
		overlay.style.zIndex = "9999";
		overlay.style.width = "100%";
		overlay.style.background = "var(--background-primary)";
		overlay.style.borderRadius = "6px";
		overlay.style.border = "1px solid var(--interactive-accent)";

		const form = document.createElement("div");
		form.className = "df-input-form";
		form.style.marginTop = "0"; // overlay specific style
		form.style.borderTop = "none";

		const timeInp = document.createElement("input");
		timeInp.type = "time";
		timeInp.className = "df-input-time";
		(timeInp as HTMLInputElement).value = ev.entryTime || "";

		const textInp = document.createElement("input");
		textInp.type = "text";
		textInp.className = "df-input-text";
		(textInp as HTMLInputElement).value = ev.text || "";
		this.attachSuggestHandlers(textInp as HTMLInputElement);

		// Key Selector
		const keySelector = document.createElement("div");
		keySelector.className = "df-key-selector";
		const ksButton = document.createElement("button");
		ksButton.type = "button";
		ksButton.className = "ks-button";

		const options: { key: string; icon: string }[] = [];
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			options.push({ key: norm, icon: k.iconSvg || "" });
		});
		if (ev.key && !options.find((o) => o.key === ev.key))
			options.unshift({ key: ev.key, icon: "" });

		let selectedKey = ev.key || (options[0] && options[0].key) || "";

		const updateKsButton = () => {
			const found = options.find((o) => o.key === selectedKey);
			if (found) {
				ksButton.innerHTML = found.icon
					? found.icon
					: this.escapeHtml(found.key.charAt(0));
			}
		};
		updateKsButton();

		// Detached Dropdown logic repeated for edit
		const ksDropdown = document.createElement("ul");
		ksDropdown.className = "ks-dropdown";
		ksDropdown.style.position = "fixed";
		ksDropdown.style.zIndex = "10060";

		options.forEach((opt) => {
			const liOpt = document.createElement("li");
			liOpt.className = "ks-option";
			liOpt.innerHTML = `${opt.icon} ${this.escapeHtml(opt.key)}`;
			liOpt.onclick = (e) => {
				e.preventDefault();
				selectedKey = opt.key;
				updateKsButton();
				try {
					ksDropdown.remove();
				} catch (e) {}
			};
			ksDropdown.appendChild(liOpt);
		});

		ksButton.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = ksButton.getBoundingClientRect();
			ksDropdown.style.top = `${rect.bottom + 5}px`;
			ksDropdown.style.left = `${rect.left}px`;
			document.body.appendChild(ksDropdown);
			const close = () => {
				try {
					ksDropdown.remove();
				} catch (e) {}
				document.removeEventListener("click", close);
			};
			document.addEventListener("click", close);
		};
		keySelector.appendChild(ksButton);

		// Action Buttons
		const actionsWrap = document.createElement("div");
		actionsWrap.className = "df-edit-actions";

		const makeActionBtn = (
			svgInner: string,
			title: string,
			cls: string = ""
		) => {
			const btn = document.createElement("div");
			btn.className = `df-action-btn ${cls}`;
			btn.title = title;
			btn.innerHTML = svgInner;
			return btn;
		};

		// Icons from settings or fallback
		const svgSave =
			this.plugin.settings.icons?.edit ||
			`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
		const svgCancel =
			this.plugin.settings.icons?.cancel ||
			`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`;
		const svgDelete =
			this.plugin.settings.icons?.trash ||
			`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

		const saveBtn = makeActionBtn(svgSave, "Сохранить", "save");
		const cancelBtn = makeActionBtn(svgCancel, "Отмена", "cancel");
		const deleteBtn = makeActionBtn(svgDelete, "Удалить", "delete");

		actionsWrap.appendChild(saveBtn);
		actionsWrap.appendChild(cancelBtn);
		actionsWrap.appendChild(deleteBtn);

		form.appendChild(timeInp);
		form.appendChild(textInp);
		form.appendChild(keySelector);
		form.appendChild(actionsWrap);
		overlay.appendChild(form);

		// Append overlay
		if (this.logListContainer) {
			this.logListContainer.appendChild(overlay);
		} else {
			this.containerEl.appendChild(overlay);
		}

		// Position overlay
		const positionOverlay = () => {
			try {
				const top = li.offsetTop;
				const left = li.offsetLeft;
				const width = li.clientWidth;
				overlay.style.top = `${top}px`;
				overlay.style.left = `${left}px`;
				overlay.style.width = `${width}px`;
			} catch {}
		};
		positionOverlay();

		// Handlers
		saveBtn.onclick = async (e) => {
			e.preventDefault();
			const prefix = selectedKey;
			const t = (timeInp as HTMLInputElement).value;
			const txt = (textInp as HTMLInputElement).value.trim();
			const entryTime = t ? t : "";
			const recordedPart = ev.recordedTime ? ` (${ev.recordedTime})` : "";
			const newLine = `${prefix}:: ${entryTime}${
				entryTime ? " " : ""
			}${txt}${recordedPart}`.trim();

			await this.updateEventLine(file, ev.idx, newLine);
			this.closeEditOverlay();
		};

		cancelBtn.onclick = (e) => {
			e.preventDefault();
			this.closeEditOverlay();
		};

		deleteBtn.onclick = async (e) => {
			e.preventDefault();
			if (confirm("Удалить это событие?")) {
				await this.removeEventLine(file, ev.idx);
				this.closeEditOverlay();
			}
		};

		setTimeout(() => (textInp as HTMLInputElement).focus(), 50);
		this.editOverlayEl = overlay;
	}

	closeEditOverlay() {
		if (this.editOverlayEl) {
			this.editOverlayEl.remove();
			this.editOverlayEl = null;
		}
		// restore hidden li
		const els = this.containerEl.querySelectorAll(".df-editing-hidden");
		els.forEach((el) => el.classList.remove("df-editing-hidden"));
	}
}
