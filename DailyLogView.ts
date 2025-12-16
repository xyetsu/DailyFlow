import { ItemView, WorkspaceLeaf, TFile, moment } from "obsidian";
import DailyLogPlugin from "./main";

export const VIEW_TYPE_DAILY_LOG = "daily-log-view";

type EventModel = {
	idx: number; // line index in file
	raw: string; // raw line text
	key: string; // normalized key (without ::)
	body: string; // raw body (everything after key::)
	entryTime: string | null; // optional leading time if detected
	recordedTime: string | null; // trailing (HH:mm) if present
	text: string; // body without times (clean text)
};

export class DailyLogView extends ItemView {
	plugin: DailyLogPlugin;
	currentDate: string;
	container: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: DailyLogPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentDate = moment().format("YYYY-MM-DD");
	}

	getViewType() {
		return VIEW_TYPE_DAILY_LOG;
	}

	getDisplayText() {
		return "Daily Flow";
	}

	getIcon() {
		return "calendar-days";
	}

	async onOpen() {
		this.container = this.contentEl;
		this.container.addClass("df-container");
		await this.render();

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path === this.getFilePath()) this.render();
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

	// ---------- Utilities ----------
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

	// ---------- Render flow ----------
	async render() {
		this.container.empty();
		this.renderHeader();

		const file = await this.getFileOrNull();
		if (!file) {
			const msgDiv = this.container.createEl("div", {
				cls: "df-msg-empty",
			});
			msgDiv.createEl("div", {
				text: `Заметка ${this.currentDate} не найдена.`,
			});
			const btn = msgDiv.createEl("button", {
				text: "Создать заметку",
				attr: { style: "margin-top: 8px;" },
			});
			btn.onclick = async () => {
				await this.createDailyNote();
				await this.render();
			};
			return;
		}

		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);

		this.renderHabits(file, cache?.frontmatter);
		this.container.createEl("hr");
		await this.renderLogList(content, file);
		this.renderInputForm();
	}

	renderHeader() {
		const header = this.container.createEl("div", { cls: "df-header" });
		const navGroup = header.createEl("div", { cls: "df-nav-group" });

		const prevBtn = navGroup.createEl("button", {
			text: "←",
			cls: "df-nav-btn",
		});
		prevBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.subtract(1, "day")
				.format("YYYY-MM-DD");
			this.render();
		};

		navGroup.createEl("span", {
			text: this.currentDate,
			cls: "df-date-title",
		});

		const nextBtn = navGroup.createEl("button", {
			text: "→",
			cls: "df-nav-btn",
		});
		nextBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.add(1, "day")
				.format("YYYY-MM-DD");
			this.render();
		};

		const today = moment().format("YYYY-MM-DD");
		if (this.currentDate !== today) {
			const todayBtn = header.createEl("button", {
				text: "Сегодня",
				cls: "df-today-btn",
			});
			todayBtn.onclick = () => {
				this.currentDate = today;
				this.render();
			};
		}
	}

	renderHabits(file: TFile, frontmatter: any) {
		const habitsDiv = this.container.createEl("div", {
			cls: "df-habits-list",
		});
		this.plugin.settings.habits.forEach((habit) => {
			const row = habitsDiv.createEl("div", { cls: "df-habit-row" });
			const left = row.createEl("div", { cls: "df-habit-label" });
			left.innerHTML = `${habit.iconSvg} ${habit.key}`;

			const val = frontmatter ? frontmatter[habit.key] : null;
			if (habit.type === "checkbox") {
				const cb = row.createEl("input", { type: "checkbox" });
				cb.addClass("df-habit-checkbox");
				(cb as HTMLInputElement).checked = val === true;
				cb.onchange = async () =>
					await this.updateFrontmatter(
						file,
						habit.key,
						(cb as HTMLInputElement).checked
					);
			} else {
				const inp = row.createEl("input", {
					type: habit.type === "number" ? "number" : "text",
				});
				inp.addClass("df-habit-input");
				(inp as HTMLInputElement).value =
					val !== undefined ? String(val) : "";
				inp.onblur = async () => {
					const current = (inp as HTMLInputElement).value;
					if (current != val) {
						const saveVal =
							habit.type === "number" ? Number(current) : current;
						await this.updateFrontmatter(file, habit.key, saveVal);
					}
				};
			}
		});
	}

	async updateFrontmatter(file: TFile, key: string, value: any) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}

	// ---------- Parsing ----------
	// parse a line like "Key:: 07:50 Text (12:34)" or "Key:: Text 17:00 19:00 (12:34)"
	// ---------- Parsing ----------
	parseEventLine(line: string, idx: number): EventModel | null {
		// Try anchored match first (key at start of line)
		const anchoredRe = /^(.+?)::\s*(.*)$/;
		let m = line.match(anchoredRe);
		let keyRaw: string | null = null;
		let rawBody = "";

		if (m) {
			keyRaw = m[1].trim();
			rawBody = (m[2] || "").trim();
		} else {
			// If no anchored match — try to find "::" anywhere (handles cases like
			// "#### *day log* dl:: 07:50 ..." where event sits on same line as a heading)
			const pos = line.indexOf("::");
			if (pos === -1) return null;

			// take substring left of "::" and take its last token as the key
			const left = line.slice(0, pos).trim();
			const right = line.slice(pos + 2).trim();
			if (!left) return null;

			const leftTokens = left.split(/\s+/);
			keyRaw = leftTokens[leftTokens.length - 1] || null;
			if (!keyRaw) return null;

			rawBody = right;
		}

		// normalize key (remove trailing :: if present)
		const key = keyRaw ? this.normalizeKey(keyRaw) : "";

		// Now extract recordedTime (trailing "(HH:MM)") and optional leading entryTime
		let entryTime: string | null = null;
		let recordedTime: string | null = null;
		let text = rawBody;

		// 1) trailing recorded time "(HH:MM)" at very end
		const trailing = text.match(/\s*\((\d{1,2}:\d{2})\)\s*$/);
		if (trailing) {
			recordedTime = trailing[1];
			text = text.substring(0, trailing.index).trim();
		}

		// 2) leading entry time like "07:50 Text" or "(07:50) Text" or "07:50- Text"
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

	// ---------- Rendering list ----------
	async renderLogList(content: string, file: TFile) {
		const logContainer = this.container.createEl("ul", {
			cls: "df-log-list",
		});
		const lines = content.split("\n");

		const events: EventModel[] = [];
		for (let i = 0; i < lines.length; i++) {
			const ev = this.parseEventLine(lines[i], i);
			if (ev) events.push(ev);
		}

		// build icon map keyed by normalized key
		const iconMap: Record<string, string> = {};
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			iconMap[norm] = k.iconSvg || "";
		});

		events.forEach((ev, posIndex) => {
			const li = this.renderEventCard(ev, iconMap, posIndex, file);
			logContainer.appendChild(li);
		});
	}

	// Highlight all HH:mm in given escaped text (except recordedTime which already removed)
	highlightTimesInText(raw: string): string {
		if (!raw) return "";

		const timeRegex = /(\d{1,2}:\d{2})/g;
		let lastIndex = 0;
		let out = "";
		let m: RegExpExecArray | null;

		while ((m = timeRegex.exec(raw)) !== null) {
			const idx = m.index;
			const matched = m[1];
			// append escaped text before match
			if (idx > lastIndex) {
				out += this.escapeHtml(raw.slice(lastIndex, idx));
			}
			// append matched time as span
			out += `<span class="df-time-inline">${this.escapeHtml(
				matched
			)}</span>`;
			lastIndex = timeRegex.lastIndex;
		}
		// append tail
		if (lastIndex < raw.length) {
			out += this.escapeHtml(raw.slice(lastIndex));
		}
		return out;
	}
	// Create DOM for single event (text with times highlighted, recordedTime kept separately)
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

		// Left: drag handle + text
		const leftWrap = document.createElement("div");
		leftWrap.className = "df-event-text";

		const handle = document.createElement("span");
		handle.className = "df-drag-handle";
		handle.textContent = "⋮";
		handle.setAttribute("draggable", "true");
		leftWrap.appendChild(handle);

		const textDiv = document.createElement("div");
		textDiv.className = "df-event-text";

		// Build bodyWithoutRecorded: remove trailing "(HH:MM)" if present
		let bodyWithoutRecorded = ev.body || "";
		bodyWithoutRecorded = bodyWithoutRecorded
			.replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, "")
			.trim();

		// Now generate safe HTML with highlighted HH:mm occurrences
		const highlightedHtml = this.highlightTimesInText(bodyWithoutRecorded);

		// Append recordedTime (if present) as df-recorded-time inside parentheses
		if (ev.recordedTime) {
			textDiv.innerHTML = `${highlightedHtml} <span class="df-recorded-time">(${this.escapeHtml(
				ev.recordedTime
			)})</span>`;
		} else {
			textDiv.innerHTML = highlightedHtml;
		}

		textDiv.style.display = "inline-block";
		textDiv.style.marginLeft = "6px";
		leftWrap.appendChild(textDiv);

		li.appendChild(leftWrap);

		// Right: meta + controls (NO separate df-event-time here)
		const rightDiv = document.createElement("div");
		rightDiv.className = "df-event-meta";

		const badge = document.createElement("div");
		badge.className = "df-key-badge";
		const spanKey = document.createElement("span");
		spanKey.textContent = ev.key;
		badge.appendChild(spanKey);
		const icon = iconMap[ev.key] || "";
		if (icon) {
			const spanI = document.createElement("span");
			spanI.className = "df-key-icon";
			spanI.innerHTML = icon;
			badge.appendChild(spanI);
		}
		rightDiv.appendChild(badge);

		const controls = document.createElement("div");
		controls.className = "df-event-controls";
		const editBtn = document.createElement("button");
		editBtn.className = "df-control-btn";
		editBtn.textContent = "✎";
		const delBtn = document.createElement("button");
		delBtn.className = "df-control-btn";
		delBtn.textContent = "🗑";
		controls.appendChild(editBtn);
		controls.appendChild(delBtn);
		rightDiv.appendChild(controls);

		li.appendChild(rightDiv);

		// --- Drag & drop handlers ---
		handle.addEventListener("dragstart", (e) => {
			e.dataTransfer!.setData("text/plain", String(ev.idx));
			li.classList.add("is-dragging");
		});
		li.addEventListener("dragend", () => {
			li.classList.remove("is-dragging");
			this.container
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
			await this.render();
		});

		// --- Delete ---
		delBtn.onclick = async () => {
			if (!confirm("Удалить это событие?")) return;
			await this.removeEventLine(file, ev.idx);
			await this.render();
		};

		// --- Edit inline ---
		editBtn.onclick = () => {
			this.renderEditInline(li, file, ev);
		};

		return li;
	}

	// Inline edit UI for a single event li
	renderEditInline(li: HTMLElement, file: TFile, ev: EventModel) {
		li.innerHTML = "";
		const existingKey = ev.key;
		const existingEntryTime = ev.entryTime || "";
		// For editing we prefer to show the body without the trailing recordedTime (it remains stored)
		let bodyWithoutRecorded = ev.body || "";
		bodyWithoutRecorded = bodyWithoutRecorded
			.replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, "")
			.trim();

		const existingText = bodyWithoutRecorded || "";
		const existingRecorded = ev.recordedTime || "";

		const form = document.createElement("div");
		form.className = "df-input-form";

		const select = document.createElement("select");
		select.className = "df-input-select";
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			const opt = document.createElement("option");
			opt.value = norm;
			opt.textContent = norm;
			if (norm === existingKey) opt.selected = true;
			select.appendChild(opt);
		});

		const timeInp = document.createElement("input");
		timeInp.type = "time";
		timeInp.className = "df-input-time";
		(timeInp as HTMLInputElement).value = existingEntryTime;

		const textInp = document.createElement("input");
		textInp.type = "text";
		textInp.className = "df-input-text";
		(textInp as HTMLInputElement).value = existingText;

		const saveBtn = document.createElement("button");
		saveBtn.className = "df-nav-btn";
		saveBtn.textContent = "Сохранить";
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "df-nav-btn";
		cancelBtn.textContent = "Отмена";

		form.appendChild(select);
		form.appendChild(timeInp);
		form.appendChild(textInp);
		form.appendChild(saveBtn);
		form.appendChild(cancelBtn);

		li.appendChild(form);

		saveBtn.onclick = async (e) => {
			e.preventDefault();
			const prefix = (select as HTMLSelectElement).value;
			const t = (timeInp as HTMLInputElement).value;
			const txt = (textInp as HTMLInputElement).value;
			// keep recorded time if it exists, otherwise set new recorded time now
			const recorded = existingRecorded || moment().format("HH:mm");
			const entryTime = t ? t : "";
			const newLine =
				`${prefix}:: ${entryTime} ${txt} (${recorded})`.trim();
			await this.updateEventLine(file, ev.idx, newLine);
			await this.render();
		};

		cancelBtn.onclick = async (e) => {
			e.preventDefault();
			await this.render();
		};
	}

	// Replace a single line in file by index
	async updateEventLine(file: TFile, lineIdx: number, newLine: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines[lineIdx] = newLine;
		await this.app.vault.modify(file, lines.join("\n"));
	}

	// Remove event line by index
	async removeEventLine(file: TFile, lineIdx: number) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines.splice(lineIdx, 1);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	// Reorder event lines: move sourceLineIdx to position of destLineIdx (insert before dest)
	async reorderEventLines(
		file: TFile,
		srcLineIdx: number,
		destLineIdx: number
	) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const eventRe = /^(.+?)::\s*(.*)$/;

		// collect indices of event lines
		const eventIndices: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (eventRe.test(lines[i].trim())) eventIndices.push(i);
		}

		// map file index -> position in eventIndices
		const srcPos = eventIndices.indexOf(srcLineIdx);
		const destPos = eventIndices.indexOf(destLineIdx);
		if (srcPos === -1 || destPos === -1) return;

		// reorder eventIndices array
		const newOrder = [...eventIndices];
		const [moved] = newOrder.splice(srcPos, 1);
		newOrder.splice(destPos, 0, moved);

		// build new events sequence
		const newEventLines = newOrder.map((i) => lines[i]);

		// write back: replace event lines in the order of eventIndices with newEventLines
		const out = [...lines];
		for (let k = 0; k < eventIndices.length; k++) {
			out[eventIndices[k]] = newEventLines[k];
		}

		await this.app.vault.modify(file, out.join("\n"));
	}

	renderInputForm() {
		const form = this.container.createEl("form", { cls: "df-input-form" });
		const timeInput = form.createEl("input", { type: "time" });
		timeInput.addClass("df-input-time");
		const textInput = form.createEl("input", {
			type: "text",
			placeholder: "Событие...",
		});
		textInput.addClass("df-input-text");

		const select = form.createEl("select", { cls: "df-input-select" });
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			const opt = select.createEl("option");
			opt.value = norm;
			opt.text = k.iconSvg || norm;
			opt.title = k.key;
		});

		form.onsubmit = async (e) => {
			e.preventDefault();
			await this.addEntry(
				(select as HTMLSelectElement).value,
				(timeInput as HTMLInputElement).value,
				(textInput as HTMLInputElement).value
			);
			(textInput as HTMLInputElement).value = "";
			(timeInput as HTMLInputElement).value = "";
		};
	}

	async addEntry(prefix: string, time: string, text: string) {
		const file = await this.getFileOrNull();
		if (!file) return;
		const recordedTime = moment().format("HH:mm");
		const entryTime = time ? time : "";
		// write prefix with :: (ensure format)
		const line =
			`${prefix}:: ${entryTime} ${text} (${recordedTime})`.trim();
		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async createDailyNote() {
		const folder = this.getFolder();
		if (!this.app.vault.getAbstractFileByPath(folder))
			await this.app.vault.createFolder(folder);
		await this.app.vault.create(this.getFilePath(), "---\n---\n");
	}
}
