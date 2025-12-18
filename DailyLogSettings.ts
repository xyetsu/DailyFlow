import { App, PluginSettingTab, Setting, Notice, Modal } from "obsidian";
import type DailyLogPlugin from "./main";

// --- Интерфейсы ---
export interface HabitConfig {
	key: string;
	type: "checkbox" | "number" | "text";
	iconSvg: string;
}

export interface LogKeyConfig {
	key: string; // will be stored normalized ending with ::
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
	habitLabelFontSize: number; // <-- НОВАЯ НАСТРОЙКА
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
	habitLabelFontSize: 13, // Размер шрифта по умолчанию (px)
};

// --- Вспомогательный класс для модального окна редактирования SVG ---
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
		const { contentEl, titleEl } = this;
		titleEl.setText(`Редактировать иконку: ${this.name}`);
		contentEl.addClass("df-edit-svg-modal");

		let svgTextArea: HTMLTextAreaElement;

		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc("Вставьте сюда полный SVG-код.")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.initialSvg;
			});

		if (this.initialSvg.trim()) {
			new Setting(contentEl)
				.setName("Предпросмотр")
				.setClass("df-svg-preview-setting")
				.addButton((btn) => {
					btn
						.setClass("df-svg-preview-btn")
						.setButtonText("").buttonEl.innerHTML = this.initialSvg;
					btn.buttonEl.style.color = "var(--interactive-accent)";
				});
		}

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
				btn.setButtonText("Отмена").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

// --- Класс модального окна для редактирования привычки ---
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
		const { contentEl, titleEl } = this;
		titleEl.setText(`Редактировать привычку: ${this.habit.key}`);
		contentEl.addClass("df-edit-svg-modal");

		let keyInput: HTMLInputElement;
		let svgTextArea: HTMLTextAreaElement;

		new Setting(contentEl)
			.setName("Название привычки (Ключ)")
			.setDesc("Это значение будет сохранено в YAML-свойствах файла.")
			.addText((text) => {
				keyInput = text.inputEl;
				text.setValue(this.habit.key);
			});

		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc("Вставьте сюда полный SVG-код.")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.habit.iconSvg;
			});

		new Setting(contentEl)
			.setName("Предпросмотр")
			.setClass("df-svg-preview-setting")
			.addButton((btn) => {
				btn
					.setClass("df-svg-preview-btn")
					.setButtonText("").buttonEl.innerHTML =
					this.habit.iconSvg || "...";
				btn.buttonEl.style.color = "var(--interactive-accent)";
				btn.setTooltip("Текущий вид иконки");
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Сохранить")
					.setCta()
					.onClick(() => {
						const newKey = keyInput.value.trim();
						const newSvg = svgTextArea.value.trim();
						if (!newKey) {
							new Notice(
								"Название привычки не может быть пустым."
							);
							return;
						}
						this.onSaveHabit(newKey, newSvg);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Отмена").onClick(() => {
					this.close();
				})
			);
	}
}

// --- Класс модального окна для редактирования ключа лога ---
class EditLogKeyModal extends EditHabitModal {
	logKey: LogKeyConfig;
	onSaveLogKey: (key: string, svg: string) => void;

	constructor(
		app: App,
		logKey: LogKeyConfig,
		onSave: (key: string, svg: string) => void
	) {
		super(
			app,
			{ key: logKey.key, type: "text", iconSvg: logKey.iconSvg },
			() => {}
		);
		this.logKey = logKey;
		this.onSaveLogKey = onSave;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(`Редактировать ключ лога: ${this.logKey.key}`);
		contentEl.addClass("df-edit-svg-modal");

		let keyInput: HTMLInputElement;
		let svgTextArea: HTMLTextAreaElement;

		new Setting(contentEl)
			.setName("Ключ лога (например, 'Идея::')")
			.setDesc("Ключ будет нормализован и должен заканчиваться на '::'.")
			.addText((text) => {
				keyInput = text.inputEl;
				text.setValue(this.logKey.key);
			});

		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc("Вставьте сюда полный SVG-код.")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.logKey.iconSvg;
			});

		new Setting(contentEl)
			.setName("Предпросмотр")
			.setClass("df-svg-preview-setting")
			.addButton((btn) => {
				btn
					.setClass("df-svg-preview-btn")
					.setButtonText("").buttonEl.innerHTML =
					this.logKey.iconSvg || "❓";
				btn.buttonEl.style.color = "var(--interactive-accent)";
				btn.setTooltip("Текущий вид иконки");
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Сохранить")
					.setCta()
					.onClick(() => {
						const newKey = keyInput.value.trim();
						const newSvg = svgTextArea.value.trim();
						if (!newKey) {
							new Notice("Ключ лога не может быть пустым.");
							return;
						}
						this.onSaveLogKey(newKey, newSvg);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Отмена").onClick(() => {
					this.close();
				})
			);
	}
}

// --- Tab Settings ---
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

		// --- STYLES SETTINGS ---
		containerEl.createEl("h3", { text: "Внешний вид" });

		new Setting(containerEl)
			.setName("Размер кнопки редактирования (по наведению)")
			.setDesc("px")
			.addText((text) =>
				text
					.setPlaceholder("18")
					.setValue(
						this.plugin.settings.hoverEditButtonSize.toString()
					)
					.onChange(async (value: string) => {
						const num = parseInt(value.trim());
						if (!isNaN(num)) {
							this.plugin.settings.hoverEditButtonSize = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Цвет времени в тексте")
			.setDesc("df-time-inline (CSS цвет)")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.timeInlineColor)
					.onChange(async (val: string) => {
						this.plugin.settings.timeInlineColor = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Жирность времени")
			.setDesc("df-time-inline")
			.addDropdown((dd) =>
				dd
					.addOption("400", "Normal")
					.addOption("600", "Semi-Bold")
					.addOption("700", "Bold")
					.setValue(this.plugin.settings.timeInlineWeight)
					.onChange(async (val: string) => {
						this.plugin.settings.timeInlineWeight = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Отступ между привычками")
			.setDesc("px")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.habitsGap.toString())
					.onChange(async (val: string) => {
						const num = parseInt(val);
						if (!isNaN(num)) {
							this.plugin.settings.habitsGap = num;
							await this.plugin.saveSettings();
						}
					})
			);

		// <-- НОВАЯ НАСТРОЙКА: Размер шрифта привычек
		new Setting(containerEl)
			.setName("Размер шрифта названия привычки")
			.setDesc("px (df-habit-label)")
			.addText((text) =>
				text
					.setValue(
						this.plugin.settings.habitLabelFontSize.toString()
					)
					.onChange(async (val: string) => {
						const num = parseInt(val);
						if (!isNaN(num)) {
							this.plugin.settings.habitLabelFontSize = num;
							await this.plugin.saveSettings();
						}
					})
			);

		// --- ICONS SETTINGS ---
		containerEl.createEl("h3", { text: "Иконки действий" });
		containerEl.createEl("p", { text: "Используйте SVG код." });

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
				text.setPlaceholder("Вставьте SVG...")
					.setValue(this.plugin.settings.icons[key])
					.onChange(async (value: string) => {
						this.plugin.settings.icons[key] = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});
			s.addButton((btn) => {
				btn.setButtonText("Предпросмотр").setClass(
					"df-svg-preview-btn"
				);
				btn.buttonEl.innerHTML = this.plugin.settings.icons[key];
			});
		};

		createSvgSetting("edit", "Иконка 'Сохранить'");
		createSvgSetting("hoverEdit", "Иконка 'Редактировать' (карандаш)");
		createSvgSetting("trash", "Иконка 'Удалить'");
		createSvgSetting("cancel", "Иконка 'Отмена'");
		createSvgSetting("dragHandle", "Иконка 'Драг-ручка'");

		// --- HABITS ---
		containerEl.createEl("h3", { text: "Привычки (Habits)" });
		const habitsContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderHabits(habitsContainer);

		new Setting(containerEl).setName("Добавить привычку").addButton((btn) =>
			btn
				.setButtonText("Добавить")
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

		// --- LOG KEYS ---
		containerEl.createEl("h3", { text: "Ключи лога (Log Keys)" });
		const logKeysContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderLogKeys(logKeysContainer);

		new Setting(containerEl)
			.setName("Добавить ключ лога")
			.addButton((btn) =>
				btn
					.setButtonText("Добавить")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.logKeys.push({
							key: "New::",
							tags: "",
							iconSvg: "📝",
						});
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}

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
					const rect = dropTargetEl.getBoundingClientRect();
					const midpoint = rect.y + rect.height / 2;
					let finalIndex = dragEndIndex;
					if (e.clientY < midpoint) finalIndex = dragEndIndex;
					else finalIndex = dragEndIndex + 1;

					if (dragStartIndex < dragEndIndex && e.clientY >= midpoint)
						finalIndex = dragEndIndex;
					else if (
						dragStartIndex > dragEndIndex &&
						e.clientY < midpoint
					)
						finalIndex = dragEndIndex;

					if (finalIndex < 0) finalIndex = 0;
					if (finalIndex > this.plugin.settings.habits.length)
						finalIndex = this.plugin.settings.habits.length;

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

		containerEl.addEventListener("dragend", () => {
			containerEl
				.querySelectorAll(
					".is-dragging, .drag-over-top, .drag-over-bottom"
				)
				.forEach((el) =>
					el.classList.remove(
						"is-dragging",
						"drag-over-top",
						"drag-over-bottom"
					)
				);
			dragSrcEl = null;
		});

		this.plugin.settings.habits.forEach((habit, index) => {
			const setting = new Setting(containerEl)
				.setName(habit.key || "Без названия")
				.setClass("df-list-item-setting");
			setting.settingEl.setAttr("draggable", "true");
			setting.settingEl.setAttr("data-index", index.toString());
			setting.settingEl.addEventListener("dragstart", handleDragStart);
			setting.settingEl.addEventListener("dragover", handleDragOver);
			setting.settingEl.addEventListener("dragleave", (e: DragEvent) =>
				(e.currentTarget as HTMLElement).classList.remove(
					"drag-over-top",
					"drag-over-bottom"
				)
			);
			setting.settingEl.addEventListener("drop", handleDrop);

			setting.addExtraButton((btn) => {
				btn.setTooltip("Перетащить");
				btn.extraSettingsEl.classList.add("df-drag-handle-btn");
				btn.extraSettingsEl.innerHTML =
					this.plugin.settings.icons.dragHandle;
				btn.extraSettingsEl.onclick = (e) => e.preventDefault();
			});
			const dragHandleEl = setting.controlEl.lastElementChild;
			if (dragHandleEl) setting.settingEl.prepend(dragHandleEl);

			setting
				.addDropdown((dd) =>
					dd
						.addOption("checkbox", "Флажок")
						.addOption("number", "Число")
						.addOption("text", "Текст")
						.setValue(habit.type)
						.onChange(async (value: any) => {
							habit.type = value;
							await this.plugin.saveSettings();
							this.display();
						})
				)
				.addButton((btn) =>
					(btn as any).setIcon("pencil").onClick(() => {
						new EditHabitModal(
							this.app,
							habit,
							(newKey: string, newSvg: string) => {
								habit.key = newKey;
								habit.iconSvg = newSvg;
								this.plugin
									.saveSettings()
									.then(() => this.display());
							}
						).open();
					})
				)
				.addButton((btn) =>
					(btn as any).setIcon("trash").onClick(async () => {
						this.plugin.settings.habits.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);

			const nameEl =
				setting.settingEl.querySelector(".setting-item-name");
			if (nameEl) {
				const iconPreviewEl = nameEl.createDiv({
					cls: "df-list-icon-preview",
				});
				iconPreviewEl.innerHTML =
					habit.iconSvg ||
					(habit.type === "checkbox"
						? this.plugin.settings.icons.edit
						: "...");
			}
		});
	}

	renderLogKeys(containerEl: HTMLElement): void {
		containerEl.empty();
		this.plugin.settings.logKeys.forEach((logKey, index) => {
			const normalizedKey = this.normalizeKey(logKey.key);
			const setting = new Setting(containerEl)
				.setName(normalizedKey || "Без ключа")
				.setClass("df-list-item-setting")
				.addText((text) =>
					text
						.setPlaceholder("tags")
						.setValue(logKey.tags)
						.onChange(async (value: string) => {
							logKey.tags = value.trim();
							await this.plugin.saveSettings();
						})
				)
				.addButton((btn) =>
					(btn as any).setIcon("pencil").onClick(() => {
						new EditLogKeyModal(
							this.app,
							logKey,
							(newKey: string, newSvg: string) => {
								logKey.key = this.normalizeKey(newKey);
								logKey.iconSvg = newSvg;
								this.plugin
									.saveSettings()
									.then(() => this.display());
							}
						).open();
					})
				)
				.addButton((btn) =>
					(btn as any).setIcon("trash").onClick(async () => {
						this.plugin.settings.logKeys.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					})
				);
			const nameEl =
				setting.settingEl.querySelector(".setting-item-name");
			if (nameEl) {
				const iconPreviewEl = nameEl.createDiv({
					cls: "df-list-icon-preview",
				});
				iconPreviewEl.innerHTML = logKey.iconSvg || "❓";
			}
		});
	}
}
