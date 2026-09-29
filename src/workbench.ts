import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { diffAgainstSnapshot } from './diff';
import { SpecStore } from './store';
import type { ComponentExample, ComponentSnapshot, ComponentSpec, PreviewDensity, PreviewTheme, PropertySpec, ValidationIssue } from './types';

type EditorTab = 'overview' | 'api' | 'accessibility' | 'examples' | 'history';

export class SpecA11yWorkbench extends LitElement {
  static properties = {
    query: { state: true },
    tab: { state: true },
    previewTheme: { state: true },
    previewDensity: { state: true },
    toast: { state: true },
    showValidation: { state: true },
    historyRevision: { state: true }
  };

  private store = new SpecStore();
  private query = '';
  private tab: EditorTab = 'overview';
  private previewTheme: PreviewTheme = 'light';
  private previewDensity: PreviewDensity = 'regular';
  private toast = '';
  private showValidation = true;
  private historyRevision: number | null = null;
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
    .item-meta .draft-line { display: block; color: var(--spectrum-orange-800, var(--spectrum-gray-800)); }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 700; background: var(--spectrum-gray-300); white-space: nowrap; }
    .pill.published { background: var(--spectrum-green-300); }
    .pill.review { background: var(--spectrum-orange-300); }
    .main { min-width: 0; padding: 22px; }
    .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; margin-bottom: 16px; }
    .title-row h2 { font-size: 28px; margin: 0; letter-spacing: -.035em; }
    .title-row p { margin: 6px 0 0; color: var(--spectrum-gray-700); }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .mode-banner {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px;
      border: 1px solid var(--spectrum-gray-300); background: var(--spectrum-gray-100);
    }
    .mode-banner.readonly { border-color: var(--spectrum-green-500); background: var(--spectrum-green-200); }
    .mode-banner.revision { border-color: var(--spectrum-orange-500); background: var(--spectrum-orange-200); }
    .mode-banner strong { flex: 1; min-width: 200px; }
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
    input:disabled, textarea:disabled, select:disabled {
      background: var(--spectrum-gray-200); color: var(--spectrum-gray-700); cursor: not-allowed; opacity: .85;
    }
    .property-list, .example-list { display: grid; gap: 12px; }
    .property-card, .example-card { border: 1px solid var(--spectrum-gray-300); border-radius: 12px; padding: 14px; background: var(--spectrum-gray-75, var(--spectrum-gray-100)); }
    .property-head, .example-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .property-head h2, .example-head strong { flex: 1; }
    .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .empty { padding: 28px; border: 1px dashed var(--spectrum-gray-400); border-radius: 12px; text-align: center; color: var(--spectrum-gray-700); }
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
    .snapshot-list { display: grid; gap: 8px; margin-top: 12px; }
    .snapshot-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      border: 1px solid var(--spectrum-gray-300); border-radius: 10px; background: var(--spectrum-gray-50);
      padding: 10px 12px; font: inherit; color: inherit; cursor: pointer;
    }
    .snapshot-item[aria-pressed='true'] { border-color: var(--spectrum-blue-600); background: var(--spectrum-blue-200); }
    .snapshot-meta { display: block; font-size: 11px; color: var(--spectrum-gray-700); margin-top: 2px; }
    .frozen-note { font-size: 11px; color: var(--spectrum-gray-700); margin-top: 8px; }
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
    if (event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.createRevisionForSelected();
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
              <span class="save-state">
                本地自动保存 · ${selected ? `r${selected.revision} · ${selected.status === 'published' ? '已发布只读' : selected.revisionOfId ? '修订草稿' : '可编辑'}` : '未选择组件'}
              </span>
            </div>
          </header>
          <div class="layout">
            <aside class="sidebar" aria-label="组件目录">
              <div class="sidebar-heading">
                <h2>组件目录</h2>
                <sp-action-button size="s" label="新建组件" @click=${() => this.store.addComponent()}>＋</sp-action-button>
              </div>
              <div class="component-list">
                ${filtered.length ? repeat(filtered, (item) => item.id, (item) => this.renderListItem(item)) : html`<div class="search-empty">没有匹配的组件。可尝试属性名、键盘行为或代码文本。</div>`}
              </div>
            </aside>
            <main class="main">${selected ? this.renderEditor(selected) : html`<div class="empty">新建或选择组件开始编辑。</div>`}</main>
            <aside class="inspector" aria-label="预览与检查">
              ${this.renderPreview(selected)}
              ${this.renderValidation(selected, selectedIssues)}
            </aside>
          </div>
          ${this.toast ? html`<sp-toast open variant="positive" timeout="3000">${this.toast}</sp-toast>` : nothing}
          <div class="footer-hint">⌘/Ctrl+Z 撤销 · ⌘/Ctrl+S 发布 · ⌘/Ctrl+K 搜索 · Alt+R 创建修订 · Alt+1–5 切换面板</div>
        </div>
      </sp-theme>
    `;
  }

  private renderListItem(item: ComponentSpec): TemplateResult {
    const parent = item.revisionOfId ? this.store.state.components.find((component) => component.id === item.revisionOfId) : undefined;
    return html`
      <button class="component-item" aria-current=${item.id === this.store.state.selectedId ? 'page' : nothing} @click=${() => this.selectComponent(item.id)}>
        <span class="item-title">
          <span>${item.name}${item.revisionOfId ? '（修订草稿）' : ''}</span>
          <span class="pill ${item.status}">${this.statusLabel(item.status)}</span>
        </span>
        <span class="item-meta">
          ${item.category} · ${item.properties.length} 个属性 · ${item.examples.length} 个示例
          ${parent ? html`<span class="draft-line">基于「${parent.name}」r${parent.revision} 已发布版</span>` : nothing}
        </span>
      </button>
    `;
  }

  private selectComponent(id: string) {
    this.historyRevision = null;
    this.store.select(id);
  }

  private renderEditor(component: ComponentSpec): TemplateResult {
    return html`
      <div class="title-row">
        <div>
          <h2>${component.name}</h2>
          <p>${component.purpose}</p>
        </div>
        <div class="actions">
          <span class="pill ${component.status}">${this.statusLabel(component.status)} · r${component.revision}</span>
          ${component.status === 'published'
            ? html`<sp-button variant="accent" @click=${() => this.createRevisionForSelected()}>创建修订</sp-button>`
            : html`
              ${component.revisionOfId ? html`<sp-button variant="secondary" @click=${() => this.store.discardRevision()}>放弃修订</sp-button>` : nothing}
              <sp-button variant="accent" @click=${() => this.publishSelected()}>${component.revisionOfId ? '发布修订' : '发布规范'}</sp-button>
            `}
        </div>
      </div>
      ${this.renderModeBanner(component)}
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

  private renderModeBanner(component: ComponentSpec): TemplateResult {
    if (component.status === 'published') {
      return html`
        <div class="mode-banner readonly" role="status">
          <strong>该规范已发布并锁定为只读，内容与历史快照不会被修改。需要变更时请创建修订草稿。</strong>
          <sp-button size="s" variant="accent" @click=${() => this.createRevisionForSelected()}>创建修订（Alt+R）</sp-button>
        </div>
      `;
    }
    if (component.revisionOfId) {
      const parent = this.store.publishedParentOf(component);
      const blockers = this.store.publishBlockers();
      return html`
        <div class="mode-banner revision" role="status">
          <strong>修订草稿：基于${parent ? `「${parent.name}」r${parent.revision} 已发布版` : '原已发布版'}复制，发布成功前原版本照旧可查；草稿已保存在本地，可随时继续处理。</strong>
          <sp-button size="s" variant="secondary" @click=${() => this.store.discardRevision()}>放弃修订</sp-button>
          <sp-button size="s" variant="accent" ?disabled=${blockers.length > 0} @click=${() => this.publishSelected()}>发布修订（⌘/Ctrl+S）</sp-button>
          ${blockers.length ? html`<span class="issue error" style="margin:0;flex-basis:100%"><strong>暂不能发布</strong>${blockers.map((message) => html`${message}<br />`)}</span>` : nothing}
        </div>
      `;
    }
    return html`
      <div class="mode-banner" role="status">
        <strong>尚未发布的规范草稿，可直接编辑并发布。</strong>
        <sp-button size="s" variant="accent" ?disabled=${this.store.publishBlockers().length > 0} @click=${() => this.publishSelected()}>发布规范</sp-button>
      </div>
    `;
  }

  private renderTab(tab: EditorTab, label: string): TemplateResult {
    return html`<button class="tab" role="tab" aria-selected=${this.tab === tab} @click=${() => { this.tab = tab; }}>${label}</button>`;
  }

  private renderOverview(component: ComponentSpec): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <section class="panel" aria-label="组件概述">
        <div class="form-grid">
          <label class="field"><span>组件名称</span><input type="text" .value=${component.name} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>分类</span><input type="text" .value=${component.category} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ category: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>用途</span><textarea .value=${component.purpose} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ purpose: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>使用规则</span><textarea .value=${component.usage} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ usage: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderApi(component: ComponentSpec): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>属性契约</h2>
          ${readonly ? nothing : html`<sp-button size="s" variant="secondary" @click=${() => this.store.addProperty()}>新增属性</sp-button>`}
        </div>
        <div class="property-list">
          ${component.properties.length ? repeat(component.properties, (item) => item.id, (property) => this.renderProperty(component, property)) : html`<div class="empty">尚未定义属性。</div>`}
        </div>
        <div class="form-grid" style="margin-top: 18px">
          <label class="field full"><span>状态说明</span><textarea .value=${component.states} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ states: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>交互签名（变化后所有关联示例将待确认）</span><textarea .value=${component.interactionSignature} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ interactionSignature: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderProperty(component: ComponentSpec, property: PropertySpec): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <article class="property-card">
        <div class="property-head">
          <strong>${property.name || '未命名属性'}</strong>
          ${readonly ? nothing : html`<sp-action-button size="s" label="删除属性" @click=${() => this.store.removeProperty(property.id)}>删除</sp-action-button>`}
        </div>
        <div class="form-grid">
          <label class="field"><span>名称（改名会同步更新引用该属性的示例）</span><input type="text" .value=${property.name} ?disabled=${readonly} @change=${(event: Event) => {
            const updated = this.store.updateProperty(property.id, { name: (event.currentTarget as HTMLInputElement).value });
            if (updated > 0) this.flash(`属性已改名，已同步更新 ${updated} 个引用示例`);
          }} /></label>
          <label class="field"><span>类型</span><input type="text" .value=${property.type} ?disabled=${readonly} @change=${(event: Event) => this.store.updateProperty(property.id, { type: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>默认值</span><input type="text" .value=${property.defaultValue} ?disabled=${readonly} @change=${(event: Event) => this.store.updateProperty(property.id, { defaultValue: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="inline"><input type="checkbox" .checked=${property.required} ?disabled=${readonly} @change=${(event: Event) => this.store.updateProperty(property.id, { required: (event.currentTarget as HTMLInputElement).checked })} /> 必填属性</label>
          <label class="field full"><span>属性说明</span><textarea .value=${property.description} ?disabled=${readonly} @change=${(event: Event) => this.store.updateProperty(property.id, { description: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </article>
    `;
  }

  private renderAccessibility(component: ComponentSpec): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <section class="panel">
        ${readonly ? html`<div class="issue info" style="margin-bottom:12px"><strong>只读视图</strong>已发布规范的键盘行为与读屏说明不可修改，请创建修订。</div>` : html`<div class="issue info" style="margin-bottom:12px"><strong>变更会传播</strong>键盘行为或读屏说明一旦修改，所有关联示例都会变为“待确认”，逐例确认前不能发布。</div>`}
        <div class="form-grid">
          <label class="field full"><span>键盘行为</span><textarea .value=${component.keyboardBehavior} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ keyboardBehavior: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>读屏说明</span><textarea .value=${component.screenReader} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ screenReader: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} ?disabled=${readonly} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderExamples(component: ComponentSpec): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>关联示例</h2>
          ${readonly ? nothing : html`<sp-button size="s" variant="secondary" @click=${() => this.store.addExample()}>新增示例</sp-button>`}
        </div>
        ${readonly ? html`<div class="issue info" style="margin-bottom:12px"><strong>只读视图</strong>示例仅可查看与复制；要修改请先创建修订。</div>` : nothing}
        <div class="example-list">
          ${component.examples.length ? repeat(component.examples, (item) => item.id, (example) => this.renderExample(component, example)) : html`<div class="empty">尚无示例。新增后会追踪属性依赖和版本契约。</div>`}
        </div>
      </section>
    `;
  }

  private renderExample(component: ComponentSpec, example: ComponentExample): TemplateResult {
    const readonly = component.status === 'published';
    return html`
      <article class="example-card">
        <div class="example-head">
          <strong>${example.title}</strong>
          <span class="pill ${example.stale ? 'review' : 'published'}">${example.stale ? '待确认' : `r${example.createdFromRevision} 已确认`}</span>
          <sp-action-button size="s" label="复制代码" @click=${() => this.copy(example.code)}>复制</sp-action-button>
          ${readonly ? nothing : html`<sp-action-button size="s" label="删除示例" @click=${() => this.store.removeExample(example.id)}>删除</sp-action-button>`}
        </div>
        ${example.stale ? html`
          <div class="issue warning">
            <strong>示例待确认</strong>${example.staleReason}
            ${readonly ? nothing : html`<br /><button @click=${() => { this.store.confirmExample(example.id); this.flash('示例已确认'); }}>已核对无误，确认示例</button>`}
          </div>` : nothing}
        <div class="form-grid">
          <label class="field full"><span>标题</span><input type="text" .value=${example.title} ?disabled=${readonly} @change=${(event: Event) => this.store.updateExample(example.id, { title: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>代码</span><textarea .value=${example.code} ?disabled=${readonly} @change=${(event: Event) => this.store.updateExample(example.id, { code: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <div class="field full">
            <span>依赖属性</span>
            <div class="inline" style="flex-wrap: wrap">
              ${component.properties.map((property) => html`
                <label class="inline"><input type="checkbox" .checked=${example.propertyIds.includes(property.id)} ?disabled=${readonly} @change=${(event: Event) => {
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
      </article>
    `;
  }

  private historySource(component: ComponentSpec): { snapshots: ComponentSnapshot[]; baseline: ComponentSpec; label: string } | undefined {
    if (component.revisionOfId) {
      const parent = this.store.publishedParentOf(component);
      if (!parent) return undefined;
      return { snapshots: parent.snapshots, baseline: component, label: `与发布版「${parent.name}」的冻结快照比较` };
    }
    return component.snapshots.length
      ? { snapshots: component.snapshots, baseline: component, label: component.status === 'published' ? '当前发布版与冻结快照比较' : '当前草稿与已冻结快照比较' }
      : undefined;
  }

  private renderHistory(component: ComponentSpec): TemplateResult {
    const source = this.historySource(component);
    const snapshots = source?.snapshots ?? [];
    const chosen = snapshots.find((snapshot) => snapshot.revision === this.historyRevision) ?? snapshots[snapshots.length - 1];
    const rows = chosen ? diffAgainstSnapshot(source!.baseline, chosen) : [];
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>版本快照</h2>
          ${component.status === 'published' ? html`<sp-button size="s" variant="accent" @click=${() => this.createRevisionForSelected()}>创建修订</sp-button>` : nothing}
        </div>
        ${component.status === 'published'
          ? html`<p>当前为已发布 r${component.revision}。快照只读，任何修改都要通过修订流程，发布成功后才会冻结新快照。</p>`
          : html`<p>当前为 r${component.revision}${component.revisionOfId ? ' 修订草稿' : ' 草稿'}。发布成功才会冻结新快照，历史快照始终保持不变。</p>`}
        ${source ? html`
          <div class="snapshot-list" role="group" aria-label="冻结快照列表">
            ${repeat(snapshots, (snapshot) => snapshot.revision, (snapshot) => html`
              <button class="snapshot-item" type="button" aria-pressed=${chosen?.revision === snapshot.revision} @click=${() => { this.historyRevision = snapshot.revision; }}>
                <span class="pill published">r${snapshot.revision}</span>
                <span>
                  ${snapshot.reason}
                  <span class="snapshot-meta">${new Date(snapshot.savedAt).toLocaleString('zh-CN')}</span>
                </span>
              </button>
            `)}
          </div>
          <p class="frozen-note">${source.label}：选中 r${chosen?.revision ?? ''}（快照内容不可修改）。</p>
          <h3>差异</h3>
          ${rows.length ? html`<div class="diff">${rows.map((row) => html`<div class="diff-row"><b>${row.field}</b><span class="before">- ${row.before || '（空）'}</span><br /><span class="after">+ ${row.after || '（空）'}</span></div>`)}</div>` : html`<div class="issue info">当前内容与所选冻结快照一致。</div>`}
        ` : html`<div class="empty">尚无冻结快照。首次发布或修订发布成功后，这里会保留每一个发布版本。</div>`}
      </section>
    `;
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

  private renderValidation(component: ComponentSpec | undefined, issues: ValidationIssue[]): TemplateResult {
    const blockers = component && component.status !== 'published' ? this.store.publishBlockers() : [];
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>规范检查</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.showValidation = !this.showValidation; }}>${this.showValidation ? '收起' : '展开'}</sp-button>
        </div>
        ${this.showValidation ? html`
          ${component && component.status !== 'published' && blockers.length ? html`
            <div class="issue error"><strong>不能发布：仍有 ${blockers.length} 项阻断问题</strong>${blockers.map((message) => html`${message}<br />`)}</div>
          ` : nothing}
          ${issues.length ? issues.map((issue) => html`
            <div class="issue ${issue.level}"><strong>${issue.target}</strong>${issue.message}</div>
          `) : html`<div class="issue info"><strong>${component?.status === 'published' ? '已发布版本通过检查' : '当前组件通过检查'}</strong>没有发现属性、示例或无障碍说明问题。</div>`}
        ` : nothing}
      </section>
    `;
  }

  private get filteredComponents(): ComponentSpec[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.store.state.components;
    return this.store.state.components.filter((component) => JSON.stringify(component).toLowerCase().includes(query));
  }

  private statusLabel(status: ComponentSpec['status']): string {
    return { draft: '草稿', review: '待审', published: '已发布' }[status];
  }

  private createRevisionForSelected() {
    const result = this.store.createRevision();
    if (result === 'created') {
      this.historyRevision = null;
      this.tab = 'overview';
      this.flash('已从发布版复制为待审修订草稿');
    } else if (result === 'existing') {
      this.historyRevision = null;
      this.flash('该组件已有进行中的修订草稿，已为你打开');
    } else {
      this.flash('只有已发布组件才能创建修订');
    }
  }

  private publishSelected() {
    const selected = this.store.selected;
    if (!selected) return;
    if (selected.status === 'published') {
      this.flash('已发布组件只读，请先创建修订');
      return;
    }
    const result = this.store.publishComponent();
    if (result.ok) {
      this.historyRevision = null;
      this.flash('发布成功，新快照已冻结，历史快照保持不变');
    } else {
      this.flash(`无法发布：${result.reason ?? '存在未解决问题'}`);
    }
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
