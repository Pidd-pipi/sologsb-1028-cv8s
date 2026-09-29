import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { diffAgainstSnapshot } from './diff';
import { SpecStore } from './store';
import type { ComponentExample, ComponentSnapshot, ComponentSpec, PreviewDensity, PreviewTheme, PropertySpec, ValidationIssue } from './types';

type EditorTab = 'overview' | 'api' | 'accessibility' | 'examples' | 'history';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namePattern = (name: string) => new RegExp(`(?<![A-Za-z0-9_$-])${escapeRegExp(name)}(?![A-Za-z0-9_$-])`);

export class SpecA11yWorkbench extends LitElement {
  static properties = {
    query: { state: true },
    tab: { state: true },
    previewTheme: { state: true },
    previewDensity: { state: true },
    toast: { state: true },
    showValidation: { state: true },
    viewedSnapshotRevision: { state: true }
  };

  private store = new SpecStore();
  private query = '';
  private tab: EditorTab = 'overview';
  private previewTheme: PreviewTheme = 'light';
  private previewDensity: PreviewDensity = 'regular';
  private toast = '';
  private showValidation = true;
  private viewedSnapshotRevision: number | null = null;
  private toastTimer?: number;

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      color: var(--spectrum-gray-900);
      background: linear-gradient(135deg, var(--spectrum-gray-100), var(--spectrum-blue-100));
      font-family: var(--spectrum-sans-font-family, Inter, ui-sans-serif, system-ui);
    }
    * { box-sizing: border-box; }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; gap: 18px; padding: 14px 22px;
      background: color-mix(in srgb, var(--spectrum-gray-50) 92%, transparent);
      border-bottom: 1px solid var(--spectrum-gray-300); backdrop-filter: blur(14px);
    }
    .brand { min-width: 245px; }
    .brand h1 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .brand p { margin: 3px 0 0; color: var(--spectrum-gray-700); font-size: 12px; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex: 1; }
    .toolbar sp-search { min-width: 280px; flex: 1; max-width: 520px; }
    .save-state { color: var(--spectrum-gray-700); font-size: 12px; white-space: nowrap; }
    .layout {
      display: grid; grid-template-columns: minmax(245px, 290px) minmax(0, 1fr) minmax(315px, 390px);
      min-height: calc(100vh - 72px);
    }
    .sidebar, .inspector { background: color-mix(in srgb, var(--spectrum-gray-50) 90%, transparent); }
    .sidebar { border-right: 1px solid var(--spectrum-gray-300); padding: 18px 12px; }
    .sidebar-heading { display: flex; justify-content: space-between; align-items: center; padding: 0 8px 12px; }
    .sidebar-heading h2, .panel h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
    .component-list { display: grid; gap: 7px; }
    .component-item {
      width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px;
      background: transparent; color: inherit; padding: 11px 12px; cursor: pointer;
    }
    .component-item:hover { background: var(--spectrum-gray-200); }
    .component-item[aria-current='page'] { border-color: var(--spectrum-blue-600); background: var(--spectrum-blue-200); }
    .item-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; }
    .item-meta { display: block; color: var(--spectrum-gray-700); font-size: 12px; margin-top: 5px; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 700; background: var(--spectrum-gray-300); }
    .pill.published { background: var(--spectrum-green-300); }
    .pill.review { background: var(--spectrum-orange-300); }
    .pill.revision { background: var(--spectrum-blue-300); }
    .main { min-width: 0; padding: 22px; }
    .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; margin-bottom: 16px; }
    .title-row h2 { font-size: 28px; margin: 0; letter-spacing: -.035em; }
    .title-row p { margin: 6px 0 0; color: var(--spectrum-gray-700); }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .tabs { display: flex; gap: 5px; overflow-x: auto; padding: 5px; border: 1px solid var(--spectrum-gray-300); border-radius: 12px; background: var(--spectrum-gray-100); margin-bottom: 16px; }
    .tab { border: 0; border-radius: 8px; background: transparent; color: var(--spectrum-gray-800); padding: 8px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
    .tab[aria-selected='true'] { background: var(--spectrum-gray-50); box-shadow: 0 1px 4px rgb(0 0 0 / .12); font-weight: 700; }
    .panel { border: 1px solid var(--spectrum-gray-300); border-radius: 16px; background: var(--spectrum-gray-50); padding: 20px; box-shadow: 0 8px 26px rgb(20 30 50 / .06); }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .field { display: grid; gap: 7px; min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    .field > span { font-size: 12px; font-weight: 700; }
    textarea, input[type='text'], select {
      width: 100%; border: 1px solid var(--spectrum-gray-400); border-radius: 8px;
      padding: 9px 10px; background: var(--spectrum-gray-50); color: var(--spectrum-gray-900);
      font: inherit; line-height: 1.5;
    }
    textarea:focus, input:focus, select:focus { outline: 3px solid var(--spectrum-blue-400); outline-offset: 1px; border-color: var(--spectrum-blue-700); }
    textarea { min-height: 110px; resize: vertical; }
    fieldset.editor { border: 0; margin: 0; padding: 0; min-width: 0; }
    fieldset.editor[disabled] { opacity: .82; }
    .property-list, .example-list { display: grid; gap: 12px; }
    .property-card, .example-card { border: 1px solid var(--spectrum-gray-300); border-radius: 12px; padding: 14px; background: var(--spectrum-gray-75, var(--spectrum-gray-100)); }
    .property-head, .example-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .property-head h2 { margin: 0; }
    .property-head strong, .example-head strong { flex: 1; }
    .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .empty { padding: 28px; border: 1px dashed var(--spectrum-gray-400); border-radius: 12px; text-align: center; color: var(--spectrum-gray-700); }
    .banner { border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .banner p { margin: 0; }
    .banner.readonly { background: var(--spectrum-gray-200); border: 1px solid var(--spectrum-gray-400); }
    .banner.revision { background: var(--spectrum-blue-100); border: 1px solid var(--spectrum-blue-400); }
    .banner.ok { background: var(--spectrum-green-100); border: 1px solid var(--spectrum-green-400); }
    .banner.blocked { background: var(--spectrum-red-100); border: 1px solid var(--spectrum-red-500); }
    .banner ul { margin: 8px 0 0; padding-left: 18px; }
    .banner li { margin: 2px 0; }
    .tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { border-radius: 999px; padding: 2px 8px; font-size: 11px; background: var(--spectrum-gray-200); }
    .chip.dangling { background: var(--spectrum-red-300); font-weight: 700; }
    .inspector { border-left: 1px solid var(--spectrum-gray-300); padding: 18px; display: grid; align-content: start; gap: 15px; }
    .preview { border-radius: 14px; border: 1px solid var(--spectrum-gray-400); padding: 18px; display: grid; place-items: center; min-height: 150px; transition: .2s; }
    .preview.dark { background: #1b1b1b; color: #f5f5f5; border-color: #444; }
    .preview.light { background: #fff; color: #111; }
    .preview.compact { padding: 9px; }
    .preview.regular { padding: 18px; }
    .preview.spacious { padding: 32px; }
    .demo-button { border: 0; border-radius: 8px; padding: 10px 16px; background: #1473e6; color: white; font: inherit; }
    .issue { border-left: 4px solid var(--spectrum-gray-500); border-radius: 8px; background: var(--spectrum-gray-100); padding: 10px 11px; margin-bottom: 8px; font-size: 12px; }
    .issue.error { border-color: var(--spectrum-red-600); }
    .issue.warning { border-color: var(--spectrum-orange-600); }
    .issue.info { border-color: var(--spectrum-blue-600); }
    .issue strong { display: block; margin-bottom: 3px; }
    .issue button { border: 0; background: transparent; color: var(--spectrum-blue-800); padding: 0; cursor: pointer; text-decoration: underline; }
    .diff { display: grid; gap: 7px; margin-top: 9px; }
    .diff-row { border: 1px solid var(--spectrum-gray-300); border-radius: 8px; padding: 9px; font-size: 11px; }
    .diff-row b { display: block; margin-bottom: 4px; text-transform: capitalize; }
    .before { color: var(--spectrum-red-800); white-space: pre-wrap; }
    .after { color: var(--spectrum-green-900); white-space: pre-wrap; }
    pre { white-space: pre-wrap; word-break: break-word; background: #202020; color: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 12px; }
    .snapshot-list { display: grid; gap: 6px; margin: 10px 0 16px; }
    .snapshot-item { display: flex; justify-content: space-between; gap: 8px; align-items: center; text-align: left; font: inherit; border: 1px solid var(--spectrum-gray-300); background: var(--spectrum-gray-50); border-radius: 8px; padding: 9px 11px; cursor: pointer; }
    .snapshot-item[aria-pressed='true'] { border-color: var(--spectrum-blue-600); background: var(--spectrum-blue-100); }
    .snapshot-meta { color: var(--spectrum-gray-700); font-size: 11px; }
    .snapshot-view h4 { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--spectrum-gray-700); }
    .snapshot-view table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .snapshot-view th, .snapshot-view td { border: 1px solid var(--spectrum-gray-300); padding: 6px 8px; text-align: left; vertical-align: top; }
    .search-empty { padding: 20px 8px; color: var(--spectrum-gray-700); font-size: 13px; }
    .footer-hint { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 30; background: #202020; color: white; border-radius: 999px; padding: 6px 12px; font-size: 11px; opacity: .9; }
    sp-toast { position: fixed; right: 18px; bottom: 18px; z-index: 50; }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: 230px minmax(0, 1fr); }
      .inspector { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--spectrum-gray-300); grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      header { flex-wrap: wrap; padding: 12px; }
      .brand { min-width: 100%; }
      .toolbar { flex-wrap: wrap; }
      .toolbar sp-search { min-width: 100%; }
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--spectrum-gray-300); }
      .inspector { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .main { padding: 14px; }
      .title-row { display: grid; }
      .actions { justify-content: flex-start; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('change', this.onStoreChange);
    window.addEventListener('keydown', this.onKeyDown);
  }

  disconnectedCallback() {
    this.store.removeEventListener('change', this.onStoreChange);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onStoreChange = () => {
    this.requestUpdate();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.publishSelected();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.renderRoot.querySelector<HTMLElement>('sp-search')?.focus();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.store.addComponent();
      return;
    }
    const tabMap: Record<string, EditorTab> = { '1': 'overview', '2': 'api', '3': 'accessibility', '4': 'examples', '5': 'history' };
    if (event.altKey && tabMap[event.key]) {
      event.preventDefault();
      this.tab = tabMap[event.key];
    }
  };

  protected render(): TemplateResult {
    const selected = this.store.selected;
    const issues = this.store.validate();
    const selectedIssues = selected ? issues.filter((item) => item.componentId === selected.id) : [];
    const filtered = this.filteredComponents;
    return html`
      <sp-theme color=${this.previewTheme === 'dark' ? 'dark' : 'light'} scale=${this.previewDensity === 'compact' ? 'medium' : 'large'}>
        <div class="app">
          <header>
            <div class="brand">
              <h1>Component Contract Studio</h1>
              <p>规范、无障碍与示例失效追踪</p>
            </div>
            <div class="toolbar">
              <sp-search
                placeholder="搜索组件、属性、键盘行为或示例"
                aria-label="全文搜索"
                .value=${this.query}
                @input=${(event: Event) => { this.query = (event.currentTarget as HTMLInputElement & { value?: string }).value ?? ''; }}
              ></sp-search>
              <sp-button variant="secondary" ?disabled=${!this.store.canUndo} @click=${() => this.store.undo()}>撤销</sp-button>
              <sp-button variant="secondary" ?disabled=${!this.store.canRedo} @click=${() => this.store.redo()}>重做</sp-button>
              ${this.renderHeaderPublish(selected)}
              <span class="save-state">本地自动保存 · ${selected ? this.statusText(selected) : '未选择组件'}</span>
            </div>
          </header>
          <div class="layout">
            <aside class="sidebar" aria-label="组件目录">
              <div class="sidebar-heading">
                <h2>组件目录</h2>
                <sp-action-button size="s" label="新建组件" @click=${() => this.store.addComponent()}>＋</sp-action-button>
              </div>
              <div class="component-list">
                ${filtered.length ? repeat(filtered, (item) => item.id, (item) => html`
                  <button class="component-item" aria-current=${item.id === this.store.state.selectedId ? 'page' : nothing} @click=${() => { this.viewedSnapshotRevision = null; this.store.select(item.id); }}>
                    <span class="item-title">
                      <span>${item.name}</span>
                      <span class="pill ${this.pillClass(item)}">${this.statusLabel(item)}</span>
                    </span>
                    <span class="item-meta">${item.category} · ${item.properties.length} 个属性 · ${item.examples.length} 个示例</span>
                    ${item.revisionOfId ? html`<span class="item-meta">修订草稿 · 基于 r${this.parentBaseline(item)?.revision ?? '?'}</span>` : nothing}
                  </button>
                `) : html`<div class="search-empty">没有匹配的组件。可尝试属性名、键盘行为或代码文本。</div>`}
              </div>
            </aside>
            <main class="main">${selected ? this.renderEditor(selected) : html`<div class="empty">新建或选择组件开始编辑。</div>`}</main>
            <aside class="inspector" aria-label="预览与检查">
              ${this.renderPreview(selected)}
              ${this.renderValidation(selectedIssues)}
            </aside>
          </div>
          ${this.toast ? html`<sp-toast open variant="positive" timeout="3000">${this.toast}</sp-toast>` : nothing}
          <div class="footer-hint">⌘/Ctrl+Z 撤销 · ⇧⌘/Ctrl+Z 重做 · ⌘/Ctrl+S 发布 · ⌘/Ctrl+K 搜索 · Alt+1–5 切换面板</div>
        </div>
      </sp-theme>
    `;
  }

  private renderHeaderPublish(component?: ComponentSpec): TemplateResult {
    if (!component) return html``;
    if (component.status === 'published') return html``;
    if (component.status === 'review') {
      return html`<sp-button variant="accent" @click=${() => this.publishSelected()}>发布${component.revisionOfId ? '修订' : ''}</sp-button>`;
    }
    return html`<sp-button variant="secondary" @click=${() => { this.store.submitForReview(); this.flash('已提交为待审'); }}>提交待审</sp-button>`;
  }

  private renderEditor(component: ComponentSpec): TemplateResult {
    return html`
      <div class="title-row">
        <div>
          <h2>${component.name}</h2>
          <p>${component.purpose}</p>
        </div>
        <div class="actions">
          <span class="pill ${this.pillClass(component)}">${this.statusLabel(component)}</span>
          ${this.renderTitleActions(component)}
        </div>
      </div>
      ${this.renderBanner(component)}
      <div class="tabs" role="tablist" aria-label="编辑区域">
        ${this.renderTab('overview', '1 概述')}
        ${this.renderTab('api', '2 属性与状态')}
        ${this.renderTab('accessibility', '3 无障碍')}
        ${this.renderTab('examples', '4 示例')}
        ${this.renderTab('history', '5 版本')}
      </div>
      ${this.tab === 'overview' ? this.renderOverview(component) : nothing}
      ${this.tab === 'api' ? this.renderApi(component) : nothing}
      ${this.tab === 'accessibility' ? this.renderAccessibility(component) : nothing}
      ${this.tab === 'examples' ? this.renderExamples(component) : nothing}
      ${this.tab === 'history' ? this.renderHistory(component) : nothing}
    `;
  }

  private renderTitleActions(component: ComponentSpec): TemplateResult {
    if (component.status === 'published') {
      const draft = component.draftId ? this.store.state.components.find((item) => item.id === component.draftId) : undefined;
      return draft
        ? html`<sp-button variant="secondary" @click=${() => { this.viewedSnapshotRevision = null; this.store.select(draft.id); }}>打开修订草稿</sp-button>`
        : html`<sp-button variant="accent" @click=${() => { this.store.startRevision(); this.flash('已从已发布版复制为待审草稿'); }}>创建修订</sp-button>`;
    }
    if (component.revisionOfId) {
      return html`
        <sp-button variant="accent" @click=${() => this.publishSelected()}>发布修订</sp-button>
        <sp-button variant="secondary" @click=${() => this.discardSelected()}>放弃修订</sp-button>
      `;
    }
    if (component.status === 'draft') {
      return html`<sp-button variant="secondary" @click=${() => { this.store.submitForReview(); this.flash('已提交为待审'); }}>提交待审</sp-button>`;
    }
    return html`<sp-button variant="accent" @click=${() => this.publishSelected()}>发布</sp-button>`;
  }

  private renderBanner(component: ComponentSpec): TemplateResult {
    if (component.status === 'published') {
      const draft = component.draftId ? this.store.state.components.find((item) => item.id === component.draftId) : undefined;
      return html`
        <div class="banner readonly">
          <p>${draft
            ? `该规范已发布（r${component.revision}）且只读；修订草稿「${draft.name}」正在处理中，原发布版仍可在“版本”中查看。`
            : `已发布规范只读（当前 r${component.revision}）。修改请创建修订：系统会复制一份待审草稿，原发布版保持不变、随时可查。`}</p>
          ${draft
            ? html`<sp-button variant="secondary" @click=${() => { this.viewedSnapshotRevision = null; this.store.select(draft.id); }}>打开修订草稿</sp-button>`
            : html`<sp-button variant="accent" @click=${() => { this.store.startRevision(); this.flash('已从已发布版复制为待审草稿'); }}>创建修订</sp-button>`}
        </div>`;
    }
    if (component.revisionOfId) {
      const baseline = this.parentBaseline(component);
      const blockers = this.store.publishBlockers(component.id);
      return html`
        <div class="banner ${blockers.length ? 'blocked' : 'ok'} revision">
          <div>
            <p><strong>修订草稿</strong>：正在修订「${this.parentName(component)}」r${baseline?.revision ?? component.revision}。发布成功后才会冻结新快照（r${(baseline?.revision ?? component.revision) + 1}），历史快照保持不变。</p>
            ${blockers.length ? html`<ul>${blockers.map((reason) => html`<li>${reason}</li>`)}</ul>` : html`<p style="margin-top:6px">可以发布：没有规范错误，也没有失效或待确认示例。</p>`}
          </div>
          <div class="actions">
            <sp-button variant="secondary" @click=${() => this.discardSelected()}>放弃修订</sp-button>
            <sp-button variant="accent" ?disabled=${blockers.length > 0} @click=${() => this.publishSelected()}>发布修订</sp-button>
          </div>
        </div>`;
    }
    if (component.status === 'review') {
      const blockers = this.store.publishBlockers(component.id);
      return html`
        <div class="banner ${blockers.length ? 'blocked' : 'ok'}">
          <div>
            <p><strong>待审</strong>：发布成功后才会冻结第一个快照。</p>
            ${blockers.length ? html`<ul>${blockers.map((reason) => html`<li>${reason}</li>`)}</ul>` : html`<p style="margin-top:6px">检查已通过，可以发布。</p>`}
          </div>
          <sp-button variant="accent" ?disabled=${blockers.length > 0} @click=${() => this.publishSelected()}>发布</sp-button>
        </div>`;
    }
    return html`
      <div class="banner readonly">
        <p>草稿尚未提交为待审；提交后需要通过规范检查、且没有失效或待确认示例才能发布。</p>
        <sp-button variant="secondary" @click=${() => { this.store.submitForReview(); this.flash('已提交为待审'); }}>提交待审</sp-button>
      </div>`;
  }

  private renderTab(tab: EditorTab, label: string): TemplateResult {
    return html`<button class="tab" role="tab" aria-selected=${this.tab === tab} @click=${() => { this.tab = tab; }}>${label}</button>`;
  }

  private renderOverview(component: ComponentSpec): TemplateResult {
    const readonly = !this.store.isWritable(component.id);
    return html`
      <section class="panel" aria-label="组件概述">
        <fieldset class="editor" ?disabled=${readonly} ?inert=${readonly}>
          <div class="form-grid">
            <label class="field"><span>组件名称</span><input type="text" .value=${component.name} @change=${(event: Event) => this.store.updateComponent({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
            <label class="field"><span>分类</span><input type="text" .value=${component.category} @change=${(event: Event) => this.store.updateComponent({ category: (event.currentTarget as HTMLInputElement).value })} /></label>
            <label class="field full"><span>用途</span><textarea .value=${component.purpose} @change=${(event: Event) => this.store.updateComponent({ purpose: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <label class="field full"><span>使用规则</span><textarea .value=${component.usage} @change=${(event: Event) => this.store.updateComponent({ usage: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          </div>
        </fieldset>
      </section>
    `;
  }

  private renderApi(component: ComponentSpec): TemplateResult {
    const readonly = !this.store.isWritable(component.id);
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>属性契约</h2>
          ${readonly ? nothing : html`<sp-button size="s" variant="secondary" @click=${() => this.store.addProperty()}>新增属性</sp-button>`}
        </div>
        <fieldset class="editor" ?disabled=${readonly} ?inert=${readonly}>
          <div class="property-list">
            ${component.properties.length ? repeat(component.properties, (item) => item.id, (property) => this.renderProperty(property, readonly)) : html`<div class="empty">尚未定义属性。</div>`}
          </div>
          <div class="form-grid" style="margin-top: 18px">
            <label class="field full"><span>状态说明</span><textarea .value=${component.states} @change=${(event: Event) => this.store.updateComponent({ states: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <label class="field full"><span>交互签名（变化后所有关联示例都会转为待确认）</span><textarea .value=${component.interactionSignature} @change=${(event: Event) => this.store.updateComponent({ interactionSignature: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          </div>
        </fieldset>
      </section>
    `;
  }

  private renderProperty(property: PropertySpec, readonly: boolean): TemplateResult {
    return html`
      <article class="property-card">
        <div class="property-head">
          <strong>${property.name || '未命名属性'}</strong>
          ${readonly ? nothing : html`<sp-action-button size="s" label="删除属性" @click=${() => this.store.removeProperty(property.id)}>删除</sp-action-button>`}
        </div>
        <div class="form-grid">
          <label class="field"><span>名称（改名只同步引用它的示例）</span><input type="text" .value=${property.name} @change=${(event: Event) => this.renameProperty(property.id, (event.currentTarget as HTMLInputElement).value)} /></label>
          <label class="field"><span>类型</span><input type="text" .value=${property.type} @change=${(event: Event) => this.store.updateProperty(property.id, { type: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>默认值</span><input type="text" .value=${property.defaultValue} @change=${(event: Event) => this.store.updateProperty(property.id, { defaultValue: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="inline"><input type="checkbox" .checked=${property.required} @change=${(event: Event) => this.store.updateProperty(property.id, { required: (event.currentTarget as HTMLInputElement).checked })} /> 必填属性</label>
          <label class="field full"><span>属性说明</span><textarea .value=${property.description} @change=${(event: Event) => this.store.updateProperty(property.id, { description: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </article>
    `;
  }

  private renderAccessibility(component: ComponentSpec): TemplateResult {
    const readonly = !this.store.isWritable(component.id);
    return html`
      <section class="panel">
        <fieldset class="editor" ?disabled=${readonly} ?inert=${readonly}>
          <div class="form-grid">
            <label class="field full"><span>键盘行为（变化后所有关联示例待确认）</span><textarea .value=${component.keyboardBehavior} @change=${(event: Event) => this.store.updateComponent({ keyboardBehavior: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <label class="field full"><span>读屏说明（变化后所有关联示例待确认）</span><textarea .value=${component.screenReader} @change=${(event: Event) => this.store.updateComponent({ screenReader: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          </div>
        </fieldset>
      </section>
    `;
  }

  private renderExamples(component: ComponentSpec): TemplateResult {
    const readonly = !this.store.isWritable(component.id);
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>关联示例</h2>
          ${readonly ? nothing : html`<sp-button size="s" variant="secondary" @click=${() => this.store.addExample()}>新增示例</sp-button>`}
        </div>
        <div class="example-list">
          ${component.examples.length ? repeat(component.examples, (item) => item.id, (example) => this.renderExample(component, example, readonly)) : html`<div class="empty">尚无示例。新增后会追踪属性依赖和版本契约。</div>`}
        </div>
      </section>
    `;
  }

  private renderExample(component: ComponentSpec, example: ComponentExample, readonly: boolean): TemplateResult {
    const dangling = example.propertyIds.filter((id) => !component.properties.some((property) => property.id === id));
    const retiredHits = component.retiredPropertyNames.filter((name) => namePattern(name).test(example.code));
    return html`
      <article class="example-card">
        <div class="example-head">
          <strong>${example.title}</strong>
          ${example.needsConfirmation ? html`<span class="pill review">待确认</span>` : nothing}
          ${example.stale ? html`<span class="pill review">引用失效</span>` : nothing}
          ${!example.stale && !example.needsConfirmation ? html`<span class="pill published">r${example.createdFromRevision}</span>` : nothing}
          <sp-action-button size="s" label="复制代码" @click=${() => this.copy(example.code)}>复制</sp-action-button>
          ${readonly ? nothing : html`<sp-action-button size="s" label="删除示例" @click=${() => this.store.removeExample(example.id)}>删除</sp-action-button>`}
        </div>
        ${example.needsConfirmation ? html`
          <div class="issue error">
            <strong>待确认：键盘 / 读屏契约已变化</strong>
            ${example.confirmReason}
            ${readonly ? nothing : html`<br /><button @click=${() => { this.store.confirmExample(example.id); this.flash('已确认该示例与新契约一致'); }}>示例仍成立，确认通过</button>`}
          </div>` : nothing}
        ${example.stale ? html`
          <div class="issue error">
            <strong>引用失效</strong>
            ${example.staleReason}
            ${readonly ? nothing : html`<br /><button @click=${() => {
              const resolved = this.store.recheckExample(example.id);
              this.flash(resolved ? '已通过重新校验，示例恢复有效' : '仍存在失效引用，请继续修改');
            }}>修改后重新校验</button>`}
          </div>` : nothing}
        ${dangling.length || retiredHits.length ? html`
          <div class="tag-row" style="margin-bottom:10px">
            ${dangling.map(() => html`<span class="chip dangling">依赖了已删除属性</span>`)}
            ${retiredHits.map((name) => html`<span class="chip dangling">代码仍引用 ${name}</span>`)}
          </div>` : nothing}
        <fieldset class="editor" ?disabled=${readonly} ?inert=${readonly}>
          <div class="form-grid">
            <label class="field full"><span>标题</span><input type="text" .value=${example.title} @change=${(event: Event) => this.store.updateExample(example.id, { title: (event.currentTarget as HTMLInputElement).value })} /></label>
            <label class="field full"><span>代码</span><textarea .value=${example.code} @change=${(event: Event) => this.store.updateExample(example.id, { code: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
            <div class="field full">
              <span>依赖属性</span>
              <div class="inline" style="flex-wrap: wrap">
                ${component.properties.map((property) => html`
                  <label class="inline"><input type="checkbox" .checked=${example.propertyIds.includes(property.id)} @change=${(event: Event) => {
                    const values = new Set(example.propertyIds);
                    (event.currentTarget as HTMLInputElement).checked ? values.add(property.id) : values.delete(property.id);
                    this.store.updateExample(example.id, { propertyIds: [...values] });
                  }} /> ${property.name}</label>
                `)}
                ${!component.properties.length ? html`<span>当前组件没有属性。</span>` : nothing}
              </div>
            </div>
            <div class="field full"><pre>${example.code}</pre></div>
          </div>
        </fieldset>
      </article>
    `;
  }

  private renderHistory(component: ComponentSpec): TemplateResult {
    const viewed = this.viewedSnapshotRevision !== null
      ? component.snapshots.find((snapshot) => snapshot.revision === this.viewedSnapshotRevision)
      : undefined;
    if (viewed) return this.renderSnapshotBrowser(component, viewed);

    const baseline = component.revisionOfId ? this.parentBaseline(component) : undefined;
    return html`
      <section class="panel">
        <div class="property-head"><h2>版本与发布</h2></div>
        ${component.status === 'published' ? html`
          <p>当前发布版为 <strong>r${component.revision}</strong>，内容只读。以下是历次发布冻结的快照，旧快照永不改变。</p>
        ` : baseline ? html`
          <p>修订草稿基于「${this.parentName(component)}」<strong>r${baseline.revision}</strong>（${new Date(baseline.savedAt).toLocaleString('zh-CN')} · ${baseline.reason}）。发布成功后才会冻结 r${baseline.revision + 1} 快照。</p>
          <h3>草稿相对已发布基线的差异</h3>
          ${this.renderDiff(component, baseline)}
        ` : html`
          <p>${component.status === 'review' ? '待审组件还没有发布过。' : '草稿还没有发布过。'}发布成功后才会冻结第一个快照；快照一经冻结即保持不变。</p>
        `}
        ${component.snapshots.length ? html`
          <h3>冻结快照${component.revisionOfId ? '（只读，来自已发布版）' : ''}</h3>
          <div class="snapshot-list">
            ${repeat(component.snapshots, (snapshot) => snapshot.revision, (snapshot) => html`
              <button class="snapshot-item" aria-pressed="false" @click=${() => { this.viewedSnapshotRevision = snapshot.revision; }}>
                <span><strong>r${snapshot.revision}</strong> · ${snapshot.reason}</span>
                <span class="snapshot-meta">${new Date(snapshot.savedAt).toLocaleString('zh-CN')}</span>
              </button>`)}
          </div>` : html`<div class="empty">尚无冻结快照。</div>`}
      </section>
    `;
  }

  private renderSnapshotBrowser(component: ComponentSpec, snapshot: ComponentSnapshot): TemplateResult {
    const body = snapshot.component;
    return html`
      <section class="panel snapshot-view">
        <div class="property-head">
          <h2>冻结快照 r${snapshot.revision}</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.viewedSnapshotRevision = null; }}>返回</sp-button>
        </div>
        <p class="snapshot-meta">${snapshot.reason} · ${new Date(snapshot.savedAt).toLocaleString('zh-CN')} · 只读，永不改变</p>
        <h4>概述</h4>
        <p><strong>${body.name}</strong>（${body.category}）</p>
        <p>${body.purpose}</p>
        <h4>属性契约</h4>
        <table>
          <thead><tr><th>名称</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead>
          <tbody>
            ${body.properties.map((property) => html`<tr><td>${property.name}</td><td>${property.type}</td><td>${property.required ? '是' : '否'}</td><td>${property.defaultValue || '—'}</td><td>${property.description}</td></tr>`)}
          </tbody>
        </table>
        <h4>键盘行为</h4><p>${body.keyboardBehavior}</p>
        <h4>读屏说明</h4><p>${body.screenReader}</p>
        <h4>关联示例（${body.examples.length}）</h4>
        ${body.examples.length ? repeat(body.examples, (example) => example.id, (example) => html`
          <div class="example-card">
            <div class="example-head"><strong>${example.title}</strong><span class="chip">r${example.createdFromRevision}</span></div>
            <pre>${example.code}</pre>
          </div>`) : html`<div class="empty">该版本没有示例。</div>`}
        ${component.revisionOfId ? html`
          <h4>当前草稿相对该快照的差异</h4>
          ${this.renderDiff(component, snapshot)}` : nothing}
      </section>
    `;
  }

  private renderDiff(component: ComponentSpec, snapshot: ComponentSnapshot): TemplateResult | string {
    const rows = diffAgainstSnapshot(component, snapshot);
    return rows.length
      ? html`<div class="diff">${rows.map((row) => html`<div class="diff-row"><b>${row.field}</b><span class="before">- ${row.before || '（空）'}</span><br /><span class="after">+ ${row.after || '（空）'}</span></div>`)}</div>`
      : '草稿与该快照内容一致。';
  }

  private renderPreview(component?: ComponentSpec): TemplateResult {
    if (!component) return html`<section class="panel"><h2>预览</h2><p>选择组件后显示主题与密度预览。</p></section>`;
    return html`
      <section class="panel">
        <div class="property-head"><h2>实时预览</h2><button class="tab" @click=${() => { this.previewTheme = this.previewTheme === 'light' ? 'dark' : 'light'; }}>${this.previewTheme === 'light' ? '深色' : '浅色'}</button></div>
        <div class="inline" style="margin-bottom: 10px">
          <label>密度</label>
          <select .value=${this.previewDensity} @change=${(event: Event) => { this.previewDensity = (event.currentTarget as HTMLSelectElement).value as PreviewDensity; }}>
            <option value="compact">紧凑</option>
            <option value="regular">标准</option>
            <option value="spacious">宽松</option>
          </select>
        </div>
        <div class="preview ${this.previewTheme} ${this.previewDensity}">
          ${component.category === 'Forms'
            ? html`<label style="width:100%"><span style="display:block;font-size:12px;margin-bottom:6px">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? '字段标签'}</span><input style="width:100%;padding:10px;border:1px solid #888;border-radius:8px" placeholder="输入内容" /></label>`
            : html`<button class="demo-button">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? component.name}</button>`}
        </div>
      </section>
    `;
  }

  private renderValidation(issues: ValidationIssue[]): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>规范检查</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.showValidation = !this.showValidation; }}>${this.showValidation ? '收起' : '展开'}</sp-button>
        </div>
        ${this.showValidation ? (issues.length ? issues.map((issue) => html`
          <div class="issue ${issue.level}"><strong>${issue.target}</strong>${issue.message}</div>
        `) : html`<div class="issue info"><strong>当前组件通过检查</strong>没有发现属性、示例或无障碍说明问题。</div>`) : nothing}
      </section>
    `;
  }

  private get filteredComponents(): ComponentSpec[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.store.state.components;
    return this.store.state.components.filter((component) => JSON.stringify(component).toLowerCase().includes(query));
  }

  private parentBaseline(component: ComponentSpec): ComponentSnapshot | undefined {
    const parent = this.store.state.components.find((item) => item.id === component.revisionOfId);
    return parent?.snapshots[0];
  }

  private parentName(component: ComponentSpec): string {
    return this.store.state.components.find((item) => item.id === component.revisionOfId)?.name ?? '已发布组件';
  }

  private pillClass(component: ComponentSpec): string {
    if (component.revisionOfId) return 'revision';
    return component.status;
  }

  private statusLabel(component: ComponentSpec): string {
    if (component.revisionOfId) return '修订草稿';
    return { draft: '草稿', review: '待审', published: '已发布' }[component.status];
  }

  private statusText(component: ComponentSpec): string {
    if (component.revisionOfId) return `修订草稿 · 基线 r${this.parentBaseline(component)?.revision ?? '?'}`;
    return `${this.statusLabel(component)} · r${component.revision}`;
  }

  private renameProperty(propertyId: string, nextName: string) {
    const synced = this.store.updateProperty(propertyId, { name: nextName });
    if (synced > 0) {
      this.flash(`属性已改名，仅同步了引用它的 ${synced} 个示例；其他示例保持不变`);
    } else {
      this.flash('没有示例引用该属性，改名未改动任何示例');
    }
  }

  private publishSelected() {
    const selected = this.store.selected;
    if (!selected) return;
    if (selected.status === 'published') {
      this.flash('已发布规范只读，请先创建修订');
      return;
    }
    if (selected.status === 'draft') {
      this.flash('草稿请先提交为待审');
      return;
    }
    const outcome = this.store.publish();
    if (outcome.ok) {
      this.viewedSnapshotRevision = null;
      this.tab = 'history';
      this.flash(`发布成功，r${outcome.revision} 快照已冻结，历史快照保持不变`);
    } else {
      this.flash(`无法发布：还有 ${outcome.reasons.length} 项需要处理`);
    }
  }

  private discardSelected() {
    const selected = this.store.selected;
    if (!selected?.revisionOfId) return;
    this.store.discardRevision();
    this.viewedSnapshotRevision = null;
    this.flash('已放弃修订草稿，原发布版未受影响');
  }

  private async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.flash('代码已复制');
    } catch {
      this.flash('复制失败，请手动选择代码');
    }
  }

  private flash(message: string) {
    this.toast = message;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast = ''; }, 3000);
  }
}

customElements.define('spec-a11y-workbench', SpecA11yWorkbench);
