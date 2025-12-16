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
	hoverEditButtonSize: number; // <-- ИЗМЕНЕНИЕ: Новое поле для размера кнопки
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
	hoverEditButtonSize: 18, // <-- ИЗМЕНЕНИЕ: Значение по умолчанию
};

// --- Вспомогательный класс для модального окна редактирования SVG ---
// ... (оставить EditSvgModal без изменений)
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

		// Поле для SVG
		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc(
				"Вставьте сюда полный SVG-код. Рекомендуемый размер viewBox='0 0 24 24' или '0 0 14 14'."
			)
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.initialSvg;
			});

		// Предпросмотр (только если SVG есть)
		if (this.initialSvg.trim()) {
			new Setting(contentEl)
				.setName("Предпросмотр")
				.setDesc("Как выглядит ваша иконка сейчас")
				.setClass("df-svg-preview-setting")
				.addButton((btn) => {
					btn
						.setClass("df-svg-preview-btn")
						.setButtonText("").buttonEl.innerHTML = this.initialSvg;
					btn.buttonEl.style.color = "var(--interactive-accent)";
					btn.setTooltip("Текущий вид иконки");
				});
		}

		// Кнопки Сохранить/Отмена
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
		const { contentEl } = this;
		contentEl.empty();
	}
}

// --- Tab Settings ---
export class DailyLogSettingTab extends PluginSettingTab {
	plugin: DailyLogPlugin;

	constructor(app: App, plugin: DailyLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// --- Вспомогательные функции ---
	normalizeKey(key: string): string {
		const trimmed = key.trim();
		return trimmed.endsWith("::") ? trimmed : trimmed ? trimmed + "::" : "";
	}

	// Вспомогательная функция для перемещения элемента в массиве
	moveItem<T>(arr: T[], from: number, to: number): T[] {
		const item = arr[from];
		arr.splice(from, 1);
		arr.splice(to, 0, item);
		return arr;
	}

	// --- Отображение ---
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Настройки Daily Flow" });

		// --- 1. Настройки иконок действий (Drag, Edit, Delete, Cancel) ---
		containerEl.createEl("h3", { text: "Иконки действий (SVG)" });
		containerEl.createEl("p", {
			text: "Вы можете заменить SVG-код для служебных кнопок. Нажмите 'Сохранить', чтобы обновить.",
		});

		const createSvgSetting = (
			key: keyof DailyLogSettings["icons"],
			name: string,
			description: string
		) => {
			new Setting(containerEl)
				.setName(name)
				// Добавляем маленький предпросмотр
				.addButton((btn) => {
					btn
						.setButtonText("")
						.setClass("df-svg-preview-btn").buttonEl.innerHTML =
						this.plugin.settings.icons[key];
					btn.setTooltip(description);
				})
				.addTextArea((text) =>
					text
						.setDisabled(false)
						.setValue(this.plugin.settings.icons[key])
						.setPlaceholder("Вставьте SVG-код здесь...")
						.onChange(async (value) => {
							this.plugin.settings.icons[key] = value.trim();
							await this.plugin.saveSettings();
							this.display();
						})
				);
		};

		createSvgSetting(
			"edit",
			'Иконка "Сохранить/Подтвердить" (в оверлее)',
			"Используется для кнопки сохранения в оверлее редактирования/добавления."
		);
		createSvgSetting(
			"hoverEdit",
			'Иконка "Редактировать событие" (по наведению)',
			"Используется для кнопки редактирования, которая появляется при наведении на событие в списке лога."
		);
		createSvgSetting(
			"trash",
			'Иконка "Удалить"',
			"Используется для кнопки удаления события."
		);
		createSvgSetting(
			"cancel",
			'Иконка "Отмена"',
			"Используется для кнопки отмены в оверлее."
		);
		createSvgSetting(
			"dragHandle",
			'Иконка "Перетащить"',
			"Используется как ручка для перетаскивания событий (⋮)."
		);

		// <-- ИЗМЕНЕНИЕ: НОВЫЙ БЛОК НАСТРОЕК РАЗМЕРА
		containerEl.createEl("h3", { text: "Настройки размеров" });

		new Setting(containerEl)
			.setName("Размер кнопки редактирования (по наведению)")
			.setDesc(
				"Задает ширину и высоту кнопки в пикселях. (Рекомендуется 16-24px)"
			)
			.addText((text) =>
				text
					.setPlaceholder("18")
					.setValue(
						this.plugin.settings.hoverEditButtonSize.toString()
					)
					.onChange(async (value) => {
						const num = parseInt(value.trim());
						if (isNaN(num) || num < 10 || num > 40) {
							// Простая валидация
							new Notice(
								"Размер должен быть числом от 10 до 40."
							);
							return;
						}
						this.plugin.settings.hoverEditButtonSize = num;
						await this.plugin.saveSettings();
						// Не перерисовываем все, чтобы не сбрасывать фокус
					})
			);
		// <-- КОНЕЦ НОВОГО БЛОКА

		// --- 2. Настройки привычек (Habits) ---
		containerEl.createEl("h3", { text: "Настройки привычек (Habits)" });
		containerEl.createEl("p", {
			text: "Здесь вы можете добавить, изменить или удалить трекеры привычек. Перетаскивайте элементы, чтобы изменить порядок.",
		});

		const habitsContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderHabits(habitsContainer);

		new Setting(containerEl)
			.setName("Добавить новую привычку")
			.setDesc("Введите название новой привычки и выберите ее тип.")
			.addButton((btn) =>
				btn
					.setButtonText("Добавить")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.habits.push({
							key: "Новая привычка",
							type: "checkbox",
							iconSvg: "",
						});
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// --- 3. Настройки ключей лога (Log Keys) ---
		containerEl.createEl("h3", {
			text: "Настройки ключей лога (Log Keys)",
		});
		containerEl.createEl("p", {
			text: "Ключи лога (например, 'dl::', 'Идея::') используются для категоризации записей.",
		});

		const logKeysContainer = containerEl.createDiv({
			cls: "df-list-container",
		});
		this.renderLogKeys(logKeysContainer);

		new Setting(containerEl)
			.setName("Добавить новый ключ лога")
			.setDesc(
				"Введите ключ (например, 'todo::') и связанные с ним теги."
			)
			.addButton((btn) =>
				btn
					.setButtonText("Добавить")
					.setCta()
					.onClick(async () => {
						this.plugin.settings.logKeys.push({
							key: "Новый ключ::",
							tags: "",
							iconSvg: "📝",
						});
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}

	// ... (renderHabits, renderLogKeys, EditHabitModal, EditLogKeyModal без изменений)

	// --- Рендеринг списка привычек с D&D ---
	renderHabits(containerEl: HTMLElement): void {
		containerEl.empty();

		// --- Drag & Drop Handlers ---
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

				// Добавляем класс, чтобы показать, куда будет вставлен элемент
				if (e.clientY < midpoint) {
					target.classList.add("drag-over-top");
				} else {
					target.classList.add("drag-over-bottom");
				}
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

					// Если бросаем выше середины, вставляем ДО целевого элемента (dragEndIndex)
					if (e.clientY < midpoint) {
						finalIndex = dragEndIndex;
						// Если бросаем ниже середины, вставляем ПОСЛЕ целевого элемента (dragEndIndex + 1)
					} else {
						finalIndex = dragEndIndex + 1;
					}

					// Корректировка: если мы перемещаем элемент с меньшим индексом (src) и вставляем после (drop),
					// фактический индекс вставки должен быть dragEndIndex.
					if (
						dragStartIndex < dragEndIndex &&
						e.clientY >= midpoint
					) {
						finalIndex = dragEndIndex;
					}
					// Если мы перемещаем элемент с большим индексом (src) и вставляем до (drop),
					// фактический индекс вставки должен быть dragEndIndex.
					else if (
						dragStartIndex > dragEndIndex &&
						e.clientY < midpoint
					) {
						finalIndex = dragEndIndex;
					}

					// Убираем возможность выхода за границы
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

		// Очистка классов при отпускании
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

			// ИСПОЛЬЗУЕМ setting.settingEl.setAttr ВМЕСТО setting.setAttr
			setting.settingEl.setAttr("draggable", "true");
			setting.settingEl.setAttr("data-index", index.toString());

			// Добавляем обработчики D&D на корневой элемент настройки
			setting.settingEl.addEventListener("dragstart", handleDragStart);
			setting.settingEl.addEventListener("dragover", handleDragOver);
			setting.settingEl.addEventListener("dragleave", (e: DragEvent) =>
				(e.currentTarget as HTMLElement).classList.remove(
					"drag-over-top",
					"drag-over-bottom"
				)
			);
			setting.settingEl.addEventListener("drop", handleDrop);

			// --- Ручка для перетаскивания (Drag Handle) ---
			setting.addExtraButton((btn) => {
				btn.setTooltip("Перетащить для изменения порядка");
				// ИСПРАВЛЕНО: используем DOM API classList.add
				btn.extraSettingsEl.classList.add("df-drag-handle-btn");

				// Устанавливаем SVG-код из настроек
				btn.extraSettingsEl.innerHTML =
					this.plugin.settings.icons.dragHandle;
				btn.extraSettingsEl.onclick = (e: MouseEvent) =>
					e.preventDefault();
			});

			// Перемещаем ручку в начало элемента (слева)
			const dragHandleEl = setting.controlEl.lastElementChild;
			if (dragHandleEl) {
				setting.settingEl.prepend(dragHandleEl);
			}

			// --- Остальные элементы управления ---

			// Тип
			setting
				.addDropdown((dd) =>
					dd
						.addOption("checkbox", "Флажок")
						.addOption("number", "Число")
						.addOption("text", "Текст")
						.setValue(habit.type)
						.onChange(
							async (value: "checkbox" | "number" | "text") => {
								habit.type = value;
								await this.plugin.saveSettings();
								this.display();
							}
						)
				)

				// Кнопка Редактировать (открывает модальное окно для key/svg)
				.addButton((btn) =>
					(btn as any)
						.setIcon("pencil")
						.setTooltip("Редактировать имя и SVG")
						.onClick(() => {
							new EditHabitModal(
								this.app,
								habit,
								(newKey, newSvg) => {
									habit.key = newKey;
									habit.iconSvg = newSvg;
									this.plugin
										.saveSettings()
										.then(() => this.display());
								}
							).open();
						})
				)

				// Кнопка Удалить
				.addButton((btn) =>
					(btn as any)
						.setIcon("trash")
						.setTooltip("Удалить привычку")
						.onClick(async () => {
							this.plugin.settings.habits.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);

			// Добавляем предпросмотр иконки (рядом с названием)
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

	// --- Рендеринг списка ключей лога ---
	renderLogKeys(containerEl: HTMLElement): void {
		containerEl.empty();

		this.plugin.settings.logKeys.forEach((logKey, index) => {
			const normalizedKey = this.normalizeKey(logKey.key);
			const setting = new Setting(containerEl)
				.setName(normalizedKey || "Без ключа")
				.setClass("df-list-item-setting")

				// Поле для тегов
				.addText((text) =>
					text
						.setPlaceholder("тег1, тег2")
						.setValue(logKey.tags)
						.onChange(async (value) => {
							logKey.tags = value.trim();
							await this.plugin.saveSettings();
						})
				)

				// Кнопка Редактировать (открывает модальное окно для ключа и SVG)
				.addButton((btn) =>
					(btn as any)
						.setIcon("pencil")
						.setTooltip("Редактировать ключ и SVG")
						.onClick(() => {
							new EditLogKeyModal(
								this.app,
								logKey,
								(newKey, newSvg) => {
									logKey.key = this.normalizeKey(newKey);
									logKey.iconSvg = newSvg;
									this.plugin
										.saveSettings()
										.then(() => this.display());
								}
							).open();
						})
				)

				// Кнопка Удалить
				.addButton((btn) =>
					(btn as any)
						.setIcon("trash")
						.setTooltip("Удалить ключ лога")
						.onClick(async () => {
							this.plugin.settings.logKeys.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);

			// Добавляем предпросмотр иконки
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

		// Поле для Ключа (Названия)
		new Setting(contentEl)
			.setName("Название привычки (Ключ)")
			.setDesc("Это значение будет сохранено в YAML-свойствах файла.")
			.addText((text) => {
				keyInput = text.inputEl;
				text.setValue(this.habit.key);
			});

		// Поле для SVG
		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc("Вставьте сюда полный SVG-код.")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.habit.iconSvg;
			});

		// Предпросмотр (в этом классе)
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

		// Кнопки Сохранить/Отмена
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

		// Поле для Ключа
		new Setting(contentEl)
			.setName("Ключ лога (например, 'Идея::')")
			.setDesc("Ключ будет нормализован и должен заканчиваться на '::'.")
			.addText((text) => {
				keyInput = text.inputEl;
				text.setValue(this.logKey.key);
			});

		// Поле для SVG
		new Setting(contentEl)
			.setName("SVG-код иконки")
			.setDesc("Вставьте сюда полный SVG-код.")
			.setClass("df-svg-textarea-setting")
			.addTextArea((text) => {
				svgTextArea = text.inputEl;
				svgTextArea.rows = 8;
				svgTextArea.value = this.logKey.iconSvg;
			});

		// Предпросмотр
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

		// Кнопки Сохранить/Отмена
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
