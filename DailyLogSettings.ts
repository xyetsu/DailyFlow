import { App, PluginSettingTab, Setting, Notice, Modal } from "obsidian";
import type DailyLogPlugin from "./main";

// --- Интерфейсы настроек ---
export interface HabitConfig {
	key: string;
	type: "checkbox" | "number" | "text";
	iconSvg: string;
}

export interface LogKeyConfig {
	key: string;
	iconSvg: string;
	tags: string;
}

export interface DailyLogSettings {
	habits: HabitConfig[];
	logKeys: LogKeyConfig[];
	icons: {
		dragHandle: string;
		edit: string;
		trash: string;
		cancel: string;
		hoverEdit: string;
	};
	hoverEditButtonSize: number;
	timeInlineColor: string;
	timeInlineWeight: string;
	habitsGap: number;
	habitLabelFontSize: number;
}

// --- Настройки по умолчанию ---
export const DEFAULT_SETTINGS: DailyLogSettings = {
	habits: [
		{
			key: "Сон",
			type: "number",
			iconSvg:
				'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>',
		},
		{
			key: "Зарядка",
			type: "checkbox",
			iconSvg:
				'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
		},
	],
	logKeys: [
		{ key: "dl::", iconSvg: "📄", tags: "" },
		{ key: "Важно::", iconSvg: "🔥", tags: "важно" },
		{ key: "Идея::", iconSvg: "💡", tags: "идея" },
	],
	icons: {
		dragHandle: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
		edit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
		trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
		cancel: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
		hoverEdit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
	},
	hoverEditButtonSize: 18,
	timeInlineColor: "var(--interactive-accent)",
	timeInlineWeight: "600",
	habitsGap: 4,
	habitLabelFontSize: 13,
};

// --- Модальные окна ---

// 1. Базовое окно редактирования SVG
class EditSvgModal extends Modal {
	name: string;
	initialSvg: string;
	onSave: (svg: string) => void;

	constructor(
		app: App,
		name: string,
		initialSvg: string,
		onSave: (svg: string) => void
	) {
		super(app);
		this.name = name;
		this.initialSvg = initialSvg;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(`Редактировать иконку: ${this.name}`);
		contentEl.addClass("df-edit-svg-modal");

		let svgTextArea: HTMLTextAreaElement;

		new Setting(contentEl)
			.setName("SVG-код")
			.setDesc("Вставьте полный SVG код")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 6;
				svgTextArea.value = this.initialSvg;
				svgTextArea.style.width = "100%";
			});

		// Preview
		new Setting(contentEl)
			.setName("Предпросмотр")
			.setClass("df-svg-preview-setting")
			.addButton((btn) => {
				btn.setClass("df-svg-preview-btn").setButtonText("");
				btn.buttonEl.innerHTML = this.initialSvg || "❓";
				btn.buttonEl.style.color = "var(--interactive-accent)";
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Сохранить")
					.setCta()
					.onClick(() => {
						this.onSave(svgTextArea.value.trim());
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Отмена").onClick(() => this.close())
			);
	}
	onClose() {
		this.contentEl.empty();
	}
}

// 2. Окно редактирования привычки (Название + SVG)
class EditHabitModal extends EditSvgModal {
	habit: HabitConfig;
	onSaveHabit: (key: string, svg: string) => void;

	constructor(
		app: App,
		habit: HabitConfig,
		onSave: (key: string, svg: string) => void
	) {
		super(app, habit.key, habit.iconSvg, () => {});
		this.habit = habit;
		this.onSaveHabit = onSave;
	}

	onOpen() {
		super.onOpen();
		this.titleEl.setText(`Редактировать привычку`);

		const container = this.contentEl;
		// Вставляем поле имени в начало контейнера (перед SVG)
		const nameDiv = document.createElement("div");
		const nameSetting = new Setting(nameDiv)
			.setName("Название")
			.addText((t) =>
				t.setValue(this.habit.key).onChange((v) => (this.habit.key = v))
			);

		container.prepend(nameDiv);

		// Переопределяем логику сохранения
		this.onSave = (svg) => {
			this.onSaveHabit(this.habit.key, svg);
		};
	}
}

// 3. Окно редактирования ключа лога
class EditLogKeyModal extends EditHabitModal {
	constructor(
		app: App,
		logKey: LogKeyConfig,
		onSave: (key: string, svg: string) => void
	) {
		// Используем ту же структуру, что и для привычек
		super(
			app,
			{ key: logKey.key, type: "text", iconSvg: logKey.iconSvg },
			onSave
		);
		this.titleEl.setText(`Редактировать ключ лога`);
	}
}

// --- Вкладка настроек ---
export class DailyLogSettingTab extends PluginSettingTab {
	plugin: DailyLogPlugin;

	constructor(app: App, plugin: DailyLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	normalizeKey(key: string): string {
		const trimmed = key.trim();
		return trimmed.endsWith("::") ? trimmed : trimmed ? trimmed + "::" : "";
	}

	moveItem<T>(arr: T[], from: number, to: number): T[] {
		const item = arr[from];
		arr.splice(from, 1);
		arr.splice(to, 0, item);
		return arr;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Настройки Daily Flow" });

		// --- СТИЛИ ---
		containerEl.createEl("h3", { text: "Внешний вид" });

		new Setting(containerEl)
			.setName("Размер кнопки редактирования")
			.setDesc("px (по наведению)")
			.addText((text) =>
				text
					.setPlaceholder(
						DEFAULT_SETTINGS.hoverEditButtonSize.toString()
					)
					.setValue(
						this.plugin.settings.hoverEditButtonSize.toString()
					)
					.onChange(async (value) => {
						const num = parseFloat(value.trim());
						if (!isNaN(num)) {
							this.plugin.settings.hoverEditButtonSize = num;
							await this.plugin.saveSettings();
						}
					})
			)
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip("Сбросить")
					.onClick(async () => {
						this.plugin.settings.hoverEditButtonSize =
							DEFAULT_SETTINGS.hoverEditButtonSize;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Цвет времени в тексте")
			.setDesc("CSS цвет (например: var(--text-muted) или red)")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.timeInlineColor)
					.onChange(async (val) => {
						this.plugin.settings.timeInlineColor = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Размер шрифта привычек")
			.setDesc("px (для названий привычек)")
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.habitLabelFontSize.toString()
					)
					.onChange(async (val) => {
						const num = parseFloat(val);
						if (!isNaN(num)) {
							this.plugin.settings.habitLabelFontSize = num;
							await this.plugin.saveSettings();
						}
					})
			)
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip("Сбросить")
					.onClick(async () => {
						this.plugin.settings.habitLabelFontSize =
							DEFAULT_SETTINGS.habitLabelFontSize;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Отступ между привычками")
			.setDesc("px")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.habitsGap.toString())
					.onChange(async (val) => {
						const num = parseFloat(val);
						if (!isNaN(num)) {
							this.plugin.settings.habitsGap = num;
							await this.plugin.saveSettings();
						}
					})
			)
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip("Сбросить")
					.onClick(async () => {
						this.plugin.settings.habitsGap =
							DEFAULT_SETTINGS.habitsGap;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		// --- ИКОНКИ ---
		containerEl.createEl("h3", { text: "Системные иконки" });
		const createSvgSetting = (
			key: keyof DailyLogSettings["icons"],
			name: string
		) => {
			const s = new Setting(containerEl)
				.setName(name)
				.setClass("df-svg-setting-block");

			s.controlEl.style.flexDirection = "column";
			s.controlEl.style.alignItems = "flex-end";

			s.addTextArea((text) => {
				text.setPlaceholder("SVG код...")
					.setValue(this.plugin.settings.icons[key])
					.onChange(async (value) => {
						this.plugin.settings.icons[key] = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
				text.inputEl.style.width = "100%";
			});
			s.addButton((btn) => {
				btn.setClass("df-svg-preview-btn").setButtonText("");
				btn.buttonEl.innerHTML = this.plugin.settings.icons[key];
			});
		};

		createSvgSetting("edit", "Сохранить");
		createSvgSetting("hoverEdit", "Редактировать");
		createSvgSetting("trash", "Удалить");
		createSvgSetting("cancel", "Отмена");

		// --- ПРИВЫЧКИ ---
		containerEl.createEl("h3", { text: "Привычки" });
		const habitsContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderHabits(habitsContainer);

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Добавить привычку")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.habits.push({
						key: "Новая",
						type: "checkbox",
						iconSvg: "",
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);

		// --- КЛЮЧИ ЛОГА ---
		containerEl.createEl("h3", { text: "Ключи лога" });
		const logKeysContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderLogKeys(logKeysContainer);

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Добавить ключ")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.logKeys.push({
						key: "Key::",
						tags: "",
						iconSvg: "📝",
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}

	// --- Логика рендера списков (D&D) ---
	renderHabits(containerEl: HTMLElement): void {
		containerEl.empty();
		let dragSrcEl: HTMLElement | null = null;
		let dragStartIndex: number;

		const handleDragStart = (e: DragEvent) => {
			dragSrcEl = e.currentTarget as HTMLElement;
			dragSrcEl.classList.add("is-dragging");
			dragStartIndex = parseInt(dragSrcEl.dataset.index || "-1");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", dragStartIndex.toString());
			}
		};

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
			const target = e.currentTarget as HTMLElement;
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			if (dragSrcEl && dragSrcEl !== target) {
				target.classList.remove("drag-over-top", "drag-over-bottom");
				const rect = target.getBoundingClientRect();
				const midpoint = rect.y + rect.height / 2;
				if (e.clientY < midpoint) target.classList.add("drag-over-top");
				else target.classList.add("drag-over-bottom");
			}
		};

		const handleDrop = async (e: DragEvent) => {
			e.preventDefault();
			const dropTargetEl = e.currentTarget as HTMLElement;
			dropTargetEl.classList.remove("drag-over-top", "drag-over-bottom");
			if (dragSrcEl && e.dataTransfer && dragSrcEl !== dropTargetEl) {
				const dragEndIndex = parseInt(
					dropTargetEl.dataset.index || "-1"
				);
				if (dragStartIndex !== -1 && dragEndIndex !== -1) {
					// Простая логика перестановки
					let finalIndex = dragEndIndex;
					const rect = dropTargetEl.getBoundingClientRect();
					if (
						e.clientY > rect.y + rect.height / 2 &&
						dragStartIndex < dragEndIndex
					)
						finalIndex = dragEndIndex;

					this.plugin.settings.habits = this.moveItem(
						this.plugin.settings.habits,
						dragStartIndex,
						finalIndex
					);
					await this.plugin.saveSettings();
					this.display();
				}
			}
			dragSrcEl?.classList.remove("is-dragging");
			dragSrcEl = null;
		};

		this.plugin.settings.habits.forEach((habit, index) => {
			const setting = new Setting(containerEl)
				.setName(habit.key || "Без названия")
				.setClass("df-list-item-setting");

			// D&D атрибуты
			setting.settingEl.setAttribute("draggable", "true");
			setting.settingEl.dataset.index = index.toString();
			setting.settingEl.addEventListener("dragstart", handleDragStart);
			setting.settingEl.addEventListener("dragover", handleDragOver);
			setting.settingEl.addEventListener("drop", handleDrop);

			// Ручка D&D
			setting.addExtraButton((btn) => {
				btn.extraSettingsEl.innerHTML =
					this.plugin.settings.icons.dragHandle;
				btn.extraSettingsEl.style.cursor = "grab";
			});

			setting.addDropdown((dd) =>
				dd
					.addOption("checkbox", "Флажок")
					.addOption("number", "Число")
					.addOption("text", "Текст")
					.setValue(habit.type)
					.onChange(async (v) => {
						habit.type = v as any;
						await this.plugin.saveSettings();
					})
			);

			setting.addButton((btn) =>
				btn.setIcon("pencil").onClick(() => {
					new EditHabitModal(this.app, habit, (k, s) => {
						habit.key = k;
						habit.iconSvg = s;
						this.plugin.saveSettings().then(() => this.display());
					}).open();
				})
			);

			setting.addButton((btn) =>
				btn.setIcon("trash").onClick(async () => {
					this.plugin.settings.habits.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		});
	}

	renderLogKeys(containerEl: HTMLElement): void {
		containerEl.empty();
		this.plugin.settings.logKeys.forEach((logKey, index) => {
			const setting = new Setting(containerEl)
				.setName(logKey.key)
				.setClass("df-list-item-setting")
				.setDesc(`Tags: ${logKey.tags || "-"}`);

			setting.addButton((btn) =>
				btn.setIcon("pencil").onClick(() => {
					new EditLogKeyModal(this.app, logKey, (k, s) => {
						logKey.key = this.normalizeKey(k);
						logKey.iconSvg = s;
						this.plugin.saveSettings().then(() => this.display());
					}).open();
				})
			);

			setting.addButton((btn) =>
				btn.setIcon("trash").onClick(async () => {
					this.plugin.settings.logKeys.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		});
	}
}
