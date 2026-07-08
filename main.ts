import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  TFile,
  moment,
  setIcon,
  Platform,
  normalizePath
} from 'obsidian';

interface FlashNoteLiteSettings {
  storageMode: 'append-daily' | 'specific-file';
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  specificFilePath: string;
  attachmentFolder: string;
  timestampFormat: string;
  addSeparator: boolean;
  addTimestamp: boolean;
  showFabButton: boolean;
}

const DEFAULT_SETTINGS: FlashNoteLiteSettings = {
  storageMode: 'append-daily',
  dailyNoteFolder: '',
  dailyNoteFormat: 'YYYY-MM-DD',
  specificFilePath: 'QuickNotes.md',
  attachmentFolder: 'attachments',
  timestampFormat: 'YYYY-MM-DD HH:mm',
  addSeparator: true,
  addTimestamp: true,
  showFabButton: false
};

class FlashNoteModal extends Modal {
  plugin: FlashNoteLite;
  textarea: HTMLTextAreaElement;
  private closing = false;

  constructor(app: App, plugin: FlashNoteLite) {
    super(app);
    this.plugin = plugin;
  }

  private onViewportResize = () => {
    const viewport = this.app.activeWindow?.visualViewport;
    if (viewport && this.containerEl) {
      this.containerEl.style.height = `${viewport.height}px`;
      this.containerEl.style.top = `${viewport.offsetTop}px`;
    }
  };

  onOpen() {
    const { contentEl, modalEl, containerEl } = this;
    const activeDoc = this.app.activeDocument ?? document;
    const activeWin = this.app.activeWindow ?? window;

    contentEl.empty();
    contentEl.addClass('flash-note-modal');

    if (Platform.isMobile) {
      containerEl.addClass('flash-note-mobile-container');
      activeWin.visualViewport?.addEventListener('resize', this.onViewportResize);
      activeWin.visualViewport?.addEventListener('scroll', this.onViewportResize);
      this.onViewportResize();
    }

    modalEl.addClass('flash-note-single-layer');
    modalEl.addClass('modal-initial');

    activeWin.requestAnimationFrame(() => {
      modalEl.classList.remove('modal-initial');
      modalEl.classList.add('modal-open');
    });

    const titleEl = contentEl.createEl('h3');
    setIcon(titleEl, 'feather');
    titleEl.appendText(' 快速记录');

    this.textarea = contentEl.createEl('textarea', {
      attr: { rows: '8', placeholder: '写下你的想法、任务…' }
    });
    this.textarea.addClass('quick-add-textarea');

    setTimeout(() => this.textarea.focus(), 150);

    const composerBar = contentEl.createDiv({ cls: 'quick-add-composer-bar' });
    const toolGroup = composerBar.createDiv({ cls: 'quick-add-tool-group' });

    const createToolButton = (iconName: string, title: string, onClick: () => void) => {
      const btn = toolGroup.createEl('button', {
        title,
        attr: { 'aria-label': title }
      });
      btn.addClass('quick-add-tool-btn');
      setIcon(btn, iconName);
      btn.onclick = onClick;
      return btn;
    };

    createToolButton('check-square', '待办事项', () => this.insertAtCursor('- [ ] '));
    createToolButton('tag', '标签', () => this.insertAtCursor('#'));
    createToolButton('list', '无序列表', () => this.insertAtCursor('- '));
    createToolButton('list-ordered', '有序列表', () => this.insertAtCursor('1. '));
    createToolButton('image-plus', '添加附件', () => this.attachFile());

    const sendBtn = composerBar.createEl('button', {
      title: '保存记录',
      attr: { 'aria-label': '保存记录' }
    });
    sendBtn.addClass('quick-add-send-btn');
    setIcon(sendBtn, 'send');
    sendBtn.onclick = () => this.saveNote();

    this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.saveNote();
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        const textarea = this.textarea;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start !== end) return;

        const value = textarea.value;
        let lineStart = value.lastIndexOf('\n', start - 1);
        if (lineStart === -1) lineStart = 0;
        else lineStart += 1;

        const lineText = value.substring(lineStart, start);
        let prefix = '';
        let shouldContinue = false;

        const todoMatch = lineText.match(/^(- \[ \] )(.*)/);
        if (todoMatch && todoMatch[2].trim() !== '') {
          prefix = '- [ ] ';
          shouldContinue = true;
        } else {
          const ulMatch = lineText.match(/^(- )(.*)/);
          if (ulMatch && ulMatch[2].trim() !== '') {
            prefix = '- ';
            shouldContinue = true;
          } else {
            const olMatch = lineText.match(/^(\d+\. )(.*)/);
            if (olMatch && olMatch[2].trim() !== '') {
              const num = parseInt(olMatch[1], 10);
              prefix = (num + 1) + '. ';
              shouldContinue = true;
            }
          }
        }

        if (shouldContinue) {
          e.preventDefault();
          const newText = '\n' + prefix;
          textarea.value = value.substring(0, start) + newText + value.substring(start);
          const newCursorPos = start + newText.length;
          textarea.selectionStart = textarea.selectionEnd = newCursorPos;
        }
      }
    });
  }

  insertAtCursor(text: string) {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const current = this.textarea.value;
    this.textarea.value =
      current.substring(0, start) + text + current.substring(end);
    this.textarea.selectionStart = this.textarea.selectionEnd =
      start + text.length;
    this.textarea.focus({ preventScroll: true });
  }

  async attachFile() {
    const activeDoc = this.app.activeDocument ?? document;
    const input = activeDoc.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const folderPath = normalizePath(this.plugin.settings.attachmentFolder || '/');
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
          await this.app.vault.createFolder(folderPath);
        }
        let fileName = file.name;
        const existing = this.app.vault.getAbstractFileByPath(
          normalizePath(`${folderPath}/${fileName}`)
        );
        if (existing) {
          const dotIndex = fileName.lastIndexOf('.');
          const ext = dotIndex !== -1 ? fileName.substring(dotIndex) : '';
          const base =
            dotIndex !== -1 ? fileName.substring(0, dotIndex) : fileName;
          fileName = `${base}_${Date.now()}${ext}`;
        }
        const filePath = normalizePath(`${folderPath}/${fileName}`);
        await this.app.vault.createBinary(filePath, arrayBuffer);
        this.insertAtCursor(`![[${fileName}]]`);
        new Notice('附件已插入');
      } catch (err) {
        new Notice('附件插入失败');
        console.error(err);
      }
    };
    input.click();
  }

  async saveNote() {
    const text = this.textarea.value.trim();
    if (!text) {
      new Notice('内容为空，未保存');
      return;
    }
    const settings = this.plugin.settings;
    let targetPath: string;
    if (settings.storageMode === 'append-daily') {
      const folder = settings.dailyNoteFolder || '';
      const dateStr = moment().format(settings.dailyNoteFormat);
      targetPath = normalizePath(folder ? `${folder}/${dateStr}.md` : `${dateStr}.md`);
    } else {
      targetPath = normalizePath(settings.specificFilePath);
    }
    try {
      const timestamp = moment().format(settings.timestampFormat);
      let recordContent = '\n';
      if (settings.addSeparator) {
        recordContent += '---\n';
      }
      if (settings.addTimestamp) {
        recordContent += `## 快速记录  ${timestamp}\n`;
      } else {
        recordContent += `## 快速记录\n`;
      }
      recordContent += `${text}\n`;

      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (file instanceof TFile) {
        await this.app.vault.process(file, (data: string) => {
          return data + recordContent;
        });
      } else {
        const dirs = targetPath.split('/');
        dirs.pop();
        if (dirs.length) {
          const dirPath = dirs.join('/');
          const folder = this.app.vault.getAbstractFileByPath(dirPath);
          if (!folder) {
            await this.app.vault.createFolder(dirPath);
          }
        }
        await this.app.vault.create(targetPath, recordContent);
      }
      new Notice(`已记录到 ${targetPath}`);
      this.close();
    } catch (err) {
      new Notice('保存失败，请检查路径设置');
      console.error(err);
    }
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    const { modalEl } = this;
    const activeWin = this.app.activeWindow ?? window;

    if (Platform.isMobile) {
      activeWin.visualViewport?.removeEventListener('resize', this.onViewportResize);
      activeWin.visualViewport?.removeEventListener('scroll', this.onViewportResize);
      this.containerEl.style.height = '';
      this.containerEl.style.top = '';
    }

    modalEl.classList.remove('modal-open');
    modalEl.classList.add('modal-closing');

    setTimeout(() => {
      super.close();
      this.closing = false;
    }, 250);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default class FlashNoteLite extends Plugin {
  settings: FlashNoteLiteSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon('feather', 'Flash Note Lite', () => {
      if (Platform.isMobile) {
        this.app.workspace.leftSplit.collapse();
      }
      new FlashNoteModal(this.app, this).open();
    });

    this.addCommand({
      id: 'open-quick-capture',
      name: 'Open flash note capture',
      callback: () => {
        new FlashNoteModal(this.app, this).open();
      }
    });

    this.addSettingTab(new FlashNoteSettingTab(this.app, this));

    if (Platform.isMobile) {
      this.app.workspace.onLayoutReady(() => {
        this.addMobileButtons();
      });
      this.registerEvent(this.app.workspace.on('layout-change', () => {
        this.addMobileButtons();
      }));
    }
  }

  private addMobileButtons() {
    // ---- 1. 导航栏按钮（有导航栏时自动添加）----
    const navbarActions = document.querySelector('.mobile-navbar-actions');
    if (navbarActions && !navbarActions.querySelector('.flash-note-navbar-btn')) {
      const btn = navbarActions.createDiv({ cls: 'navbar-button flash-note-navbar-btn' });
      setIcon(btn, 'feather');
      btn.setAttribute('aria-label', 'Flash Note Lite');
      btn.onclick = () => {
        this.app.workspace.leftSplit.collapse();
        new FlashNoteModal(this.app, this).open();
      };
      navbarActions.appendChild(btn);
    }

    // ---- 2. 浮动按钮 FAB（始终创建，根据设置控制显示/隐藏）----
    let fab = document.querySelector('.flash-note-fab') as HTMLElement;
    if (!fab) {
      fab = document.body.createDiv({ cls: 'flash-note-fab' });
      setIcon(fab, 'feather');
      fab.setAttribute('aria-label', 'Flash Note Lite');
      fab.onclick = () => {
        new FlashNoteModal(this.app, this).open();
      };
    }
    // 使用 CSS 类控制显示/隐藏，避免与 !important 冲突
    if (this.settings.showFabButton) {
      fab.classList.remove('flash-note-fab-hidden');
    } else {
      fab.classList.add('flash-note-fab-hidden');
    }
  }

  onunload() {
    document.querySelectorAll('.flash-note-navbar-btn, .flash-note-fab').forEach(el => el.remove());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class FlashNoteSettingTab extends PluginSettingTab {
  plugin: FlashNoteLite;

  constructor(app: App, plugin: FlashNoteLite) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Options' });

    new Setting(containerEl)
      .setName('记录方式')
      .setDesc('选择将快速记录追加到何处')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('append-daily', '追加到每日日记')
          .addOption('specific-file', '追加到指定笔记')
          .setValue(this.plugin.settings.storageMode)
          .onChange(async (value) => {
            this.plugin.settings.storageMode = value as
              | 'append-daily'
              | 'specific-file';
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.storageMode === 'append-daily') {
      new Setting(containerEl)
        .setName('日记文件夹')
        .setDesc('存放日记的文件夹路径，留空则存放到库根目录')
        .addText((text) =>
          text
            .setPlaceholder('例如：DailyNotes')
            .setValue(this.plugin.settings.dailyNoteFolder)
            .onChange(async (value) => {
              this.plugin.settings.dailyNoteFolder = value;
              await this.plugin.saveSettings();
            })
        );
      new Setting(containerEl)
        .setName('日记文件名格式')
        .setDesc('使用 Moment.js 格式，默认为 YYYY-MM-DD')
        .addText((text) =>
          text
            .setPlaceholder('YYYY-MM-DD')
            .setValue(this.plugin.settings.dailyNoteFormat)
            .onChange(async (value) => {
              this.plugin.settings.dailyNoteFormat = value || 'YYYY-MM-DD';
              await this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(containerEl)
        .setName('目标笔记路径')
        .setDesc('所有快速记录将追加到此文件，如 QuickNotes.md')
        .addText((text) =>
          text
            .setPlaceholder('QuickNotes.md')
            .setValue(this.plugin.settings.specificFilePath)
            .onChange(async (value) => {
              this.plugin.settings.specificFilePath = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName('时间戳格式')
      .setDesc('用于每次记录的时间显示，使用 Moment.js 格式')
      .addText((text) =>
        text
          .setPlaceholder('YYYY-MM-DD HH:mm')
          .setValue(this.plugin.settings.timestampFormat)
          .onChange(async (value) => {
            this.plugin.settings.timestampFormat = value || 'YYYY-MM-DD HH:mm';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('添加分隔线')
      .setDesc('在每次记录前插入 "---" 分隔线')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addSeparator)
          .onChange(async (value) => {
            this.plugin.settings.addSeparator = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('显示时间戳')
      .setDesc('在记录标题后显示时间')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addTimestamp)
          .onChange(async (value) => {
            this.plugin.settings.addTimestamp = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('附件存放目录')
      .setDesc('通过按钮插入的附件将复制到此文件夹')
      .addText((text) =>
        text
          .setPlaceholder('attachments')
          .setValue(this.plugin.settings.attachmentFolder)
          .onChange(async (value) => {
            this.plugin.settings.attachmentFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // ---- 新增：浮动按钮开关 ----
    new Setting(containerEl)
      .setName('显示浮动按钮')
      .setDesc('在移动端显示右下角的浮动快速记录按钮（FAB）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFabButton)
          .onChange(async (value) => {
            this.plugin.settings.showFabButton = value;
            await this.plugin.saveSettings();
            // 实时更新 FAB 显示状态
            const fab = document.querySelector('.flash-note-fab') as HTMLElement;
            if (fab) {
              if (value) {
                fab.classList.remove('flash-note-fab-hidden');
              } else {
                fab.classList.add('flash-note-fab-hidden');
              }
            }
          })
      );
  }
}
