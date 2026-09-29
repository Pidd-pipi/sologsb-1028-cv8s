import { createInitialState } from './data';
import type { ComponentSnapshot, ComponentSpec, PublishOutcome, ValidationIssue, WorkspaceState } from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v1';

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 标识符边界：允许属性名出现在 `prop="x"`、`[prop]` 等位置，但不能是更长标识符的一部分。
const namePattern = (name: string) => new RegExp(`(?<![A-Za-z0-9_$-])${escapeRegExp(name)}(?![A-Za-z0-9_$-])`, 'g');

const CONFIRM_REASON = '键盘行为、读屏说明或交互签名已变化，请逐条确认示例仍然成立。';

/** 这些字段变化意味着交互/无障碍契约变化，所有关联示例都需要人工确认。 */
const CONTRACT_FIELDS = ['keyboardBehavior', 'screenReader', 'interactionSignature'] as const;

const freezeSnapshot = (
  source: ComponentSpec,
  reason: string,
  savedAt = new Date().toISOString()
): { snapshot: ComponentSnapshot; body: Omit<ComponentSpec, 'snapshots'> } => {
  const { snapshots: _ignored, ...body } = clone(source);
  return { snapshot: { revision: source.revision, savedAt, reason, component: clone(body) }, body };
};

export class SpecStore extends EventTarget {
  state: WorkspaceState;
  private undoStack: WorkspaceState[] = [];
  private redoStack: WorkspaceState[] = [];
  private lastAction = '';

  constructor() {
    super();
    this.state = this.hydrate(this.load());
  }

  get selected(): ComponentSpec | undefined {
    return this.state.components.find((item) => item.id === this.state.selectedId);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastUndoLabel() { return this.lastAction; }

  /** 已发布组件只读；只有草稿（含修订草稿）允许修改。 */
  isWritable(componentId?: string): boolean {
    const id = componentId ?? this.state.selectedId;
    const component = this.state.components.find((item) => item.id === id);
    return !!component && component.status !== 'published';
  }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist(false);
    this.emit();
  }

  addComponent() {
    const id = uid('component');
    const component: ComponentSpec = {
      id,
      name: 'Untitled component',
      category: 'Uncategorised',
      status: 'draft',
      purpose: '说明该组件解决的用户问题。',
      usage: '说明何时使用、何时不要使用。',
      properties: [],
      states: 'default、hover、focus-visible、disabled。',
      keyboardBehavior: '记录 Tab、Enter、Space、方向键和 Esc 等行为。',
      screenReader: '记录角色、名称、状态和动态播报。',
      disabledScenarios: '记录不应使用该组件的场景。',
      interactionSignature: '',
      examples: [],
      revision: 1,
      updatedAt: new Date().toISOString(),
      snapshots: [],
      retiredPropertyNames: []
    };
    this.commit('新建组件', (state) => {
      state.components.unshift(component);
      state.selectedId = id;
    }, { clearHistory: true });
  }

  updateComponent(patch: Partial<ComponentSpec>) {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('编辑组件', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      // 状态与修订关联只能通过专用流程（提交待审 / 创建修订 / 发布）修改。
      const { status: _status, revisionOfId: _revisionOfId, draftId: _draftId, snapshots: _snapshots, ...fields } = patch;
      const contractChanged = CONTRACT_FIELDS.some(
        (field) => field in fields && String(fields[field] ?? '') !== String(target[field] ?? '')
      );
      Object.assign(target, fields, { updatedAt: new Date().toISOString() });
      if (contractChanged) {
        target.examples.forEach((example) => {
          example.needsConfirmation = true;
          example.confirmReason = CONFIRM_REASON;
        });
      }
    });
  }

  addProperty() {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('新增属性', (state) => {
      state.components.find((item) => item.id === selected.id)?.properties.push({
        id: uid('property'),
        name: 'newProperty',
        type: 'string',
        required: false,
        defaultValue: '',
        description: '描述该属性对开发者和用户的影响。'
      });
    });
  }

  /**
   * 编辑属性。属性改名时只同步引用它的示例（按依赖关系或代码中的旧名匹配），
   * 替换代码里的旧名并保持依赖 id 不变；其他示例完全不动。返回被更新的示例数量。
   */
  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>): number {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return 0;
    let synced = 0;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      if (typeof patch.name === 'string' && patch.name.trim() && patch.name !== property.name) {
        const oldName = property.name;
        const token = namePattern(oldName);
        target.examples.forEach((example) => {
          const references = example.propertyIds.includes(propertyId) || token.test(example.code);
          token.lastIndex = 0;
          if (references) {
            example.code = example.code.replace(namePattern(oldName), patch.name as string);
            synced += 1;
          }
        });
      }
      Object.assign(property, patch);
    });
    return synced;
  }

  removeProperty(propertyId: string) {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('删除属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      target.properties = target.properties.filter((item) => item.id !== propertyId);
      if (property.name && !target.retiredPropertyNames.includes(property.name)) {
        target.retiredPropertyNames.push(property.name);
      }
      const token = namePattern(property.name);
      target.examples.forEach((example) => {
        if (example.propertyIds.includes(propertyId) || token.test(example.code)) {
          example.stale = true;
          example.staleReason = `属性 ${property.name} 已删除，示例代码或依赖仍引用它，请更新后重新校验。`;
        }
      });
    });
  }

  addExample() {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    const exampleId = uid('example');
    this.commit('新增示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.examples.push({
        id: exampleId,
        title: '新示例',
        code: `<${target.name.toLowerCase().replaceAll(' ', '-')}>示例</${target.name.toLowerCase().replaceAll(' ', '-')}>`,
        propertyIds: [],
        stale: false,
        staleReason: '',
        needsConfirmation: false,
        confirmReason: '',
        createdFromRevision: target.revision
      });
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('编辑示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) target.examples = target.examples.filter((item) => item.id !== exampleId);
    });
  }

  /** 重新校验失效引用：依赖属性已不存在或代码仍出现已退役属性名时保持失效，否则解除。 */
  recheckExample(exampleId: string): boolean {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return false;
    let resolved = false;
    this.commit('重新校验示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (!target || !example) return;
      const activeIds = new Set(target.properties.map((property) => property.id));
      const dangling = example.propertyIds.filter((id) => !activeIds.has(id));
      const retiredHits = target.retiredPropertyNames.filter((name) => namePattern(name).test(example.code));
      if (dangling.length === 0 && retiredHits.length === 0) {
        example.stale = false;
        example.staleReason = '';
        resolved = true;
      } else {
        const parts: string[] = [];
        if (retiredHits.length) parts.push(`代码仍引用已删除属性：${retiredHits.join('、')}`);
        if (dangling.length) parts.push('依赖列表中仍存在已删除属性，请取消勾选');
        example.stale = true;
        example.staleReason = parts.join('；') + '。';
      }
    });
    return resolved;
  }

  /** 人工确认示例在新的键盘/读屏契约下仍然成立。 */
  confirmExample(exampleId: string) {
    const selected = this.selected;
    if (!selected || !this.isWritable(selected.id)) return;
    this.commit('确认示例', (state) => {
      const example = state.components
        .find((item) => item.id === selected.id)
        ?.examples.find((item) => item.id === exampleId);
      if (example) {
        example.needsConfirmation = false;
        example.confirmReason = '';
      }
    });
  }

  /**
   * 从已发布组件创建修订：原发布版保持不动且继续可查，复制一份为待审草稿。
   * 每个已发布组件同时只允许一个进行中的修订草稿。
   */
  startRevision(componentId?: string) {
    const sourceId = componentId ?? this.state.selectedId;
    const source = this.state.components.find((item) => item.id === sourceId);
    if (!source || source.status !== 'published' || source.draftId) return;
    const draftId = uid('component');
    this.commit('创建修订', (state) => {
      const parent = state.components.find((item) => item.id === sourceId);
      if (!parent || parent.draftId) return;
      const draft = clone(parent);
      draft.id = draftId;
      draft.status = 'review';
      draft.revisionOfId = parent.id;
      draft.draftId = undefined;
      draft.updatedAt = new Date().toISOString();
      // 草稿暂不冻结任何快照；历史快照仅作为只读基线保留。
      draft.examples.forEach((example) => {
        example.needsConfirmation = false;
        example.confirmReason = '';
      });
      parent.draftId = draftId;
      const parentIndex = state.components.findIndex((item) => item.id === parent.id);
      state.components.splice(parentIndex + 1, 0, draft);
      state.selectedId = draftId;
    }, { clearHistory: true });
  }

  /** 放弃修订草稿：原发布版不受影响。 */
  discardRevision(componentId?: string) {
    const draftId = componentId ?? this.state.selectedId;
    this.commit('放弃修订', (state) => {
      const draft = state.components.find((item) => item.id === draftId);
      if (!draft || draft.status === 'published' || !draft.revisionOfId) return;
      const parent = state.components.find((item) => item.id === draft.revisionOfId);
      if (parent) parent.draftId = undefined;
      state.components = state.components.filter((item) => item.id !== draft.id);
      state.selectedId = draft.revisionOfId as string;
    }, { clearHistory: true });
  }

  /** 从未发布的草稿提交为待审。修订草稿创建时即为待审。 */
  submitForReview(componentId?: string) {
    const id = componentId ?? this.state.selectedId;
    const component = this.state.components.find((item) => item.id === id);
    if (!component || component.status !== 'draft' || component.revisionOfId) return;
    this.commit('提交待审', (state) => {
      const target = state.components.find((item) => item.id === id);
      if (target) {
        target.status = 'review';
        target.updatedAt = new Date().toISOString();
      }
    }, { clearHistory: true });
  }

  /** 发布前检查：规范错误、失效或待确认示例都会阻止发布。 */
  publishBlockers(componentId?: string): string[] {
    const id = componentId ?? this.state.selectedId;
    const component = this.state.components.find((item) => item.id === id);
    if (!component) return ['未选择组件。'];
    if (component.status === 'published') return ['该组件已经发布；如需修改请先创建修订。'];
    if (component.status !== 'review') return ['组件还是草稿，请先提交为待审。'];
    const reasons = this.validate()
      .filter((issue) => issue.componentId === id && issue.level === 'error')
      .map((issue) => `${issue.target}：${issue.message}`);
    return reasons;
  }

  /**
   * 发布：只有发布成功才冻结新快照，历史快照一律保持不变。
   * 修订发布后内容覆盖回原组件（id 与历史不变），草稿移除；原发布版仍可在快照中查看。
   */
  publish(componentId?: string): PublishOutcome {
    const id = componentId ?? this.state.selectedId;
    const blockers = this.publishBlockers(id);
    if (blockers.length) return { ok: false, reasons: blockers };

    const component = this.state.components.find((item) => item.id === id)!;
    let resultingRevision = component.revision;
    this.commit('发布版本', (state) => {
      const target = state.components.find((item) => item.id === id);
      if (!target) return;
      const parent = target.revisionOfId
        ? state.components.find((item) => item.id === target.revisionOfId)
        : undefined;

      if (parent) {
        const nextRevision = parent.revision + 1;
        target.revision = nextRevision;
        target.examples.forEach((example) => { example.createdFromRevision = nextRevision; });
        const { snapshot } = freezeSnapshot(target, `发布修订 r${nextRevision}`);
        delete snapshot.component.revisionOfId;
        delete snapshot.component.draftId;
        parent.snapshots.unshift(snapshot);
        const { snapshots: _draftSnapshots, ...draftBody } = clone(target);
        Object.assign(parent, draftBody, {
          id: parent.id,
          status: 'published' as const,
          revisionOfId: undefined,
          draftId: undefined,
          snapshots: parent.snapshots,
          updatedAt: new Date().toISOString()
        });
        state.components = state.components.filter((item) => item.id !== target.id);
        state.selectedId = parent.id;
        resultingRevision = nextRevision;
      } else {
        const { snapshot } = freezeSnapshot(target, `发布 r${target.revision}`);
        target.snapshots.unshift(snapshot);
        target.status = 'published';
        target.examples.forEach((example) => { example.createdFromRevision = target.revision; });
        target.updatedAt = new Date().toISOString();
        resultingRevision = target.revision;
      }
    }, { clearHistory: true });
    return { ok: true, reasons: [], revision: resultingRevision };
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const component of this.state.components) {
      const names = new Map<string, number>();
      component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
      for (const [name, count] of names) {
        if (name && count > 1) {
          issues.push({ id: `${component.id}-duplicate-${name}`, level: 'error', componentId: component.id, target: component.name, message: `属性名称 ${name} 重复。`, field: 'properties' });
        }
      }
      const activeIds = new Set(component.properties.map((property) => property.id));
      component.examples.forEach((example) => {
        const missingReferences = example.propertyIds.filter((propertyId) => !activeIds.has(propertyId));
        const retiredHits = component.retiredPropertyNames.filter((name) => namePattern(name).test(example.code));
        if (missingReferences.length || retiredHits.length) {
          const detail = retiredHits.length
            ? `示例仍引用已删除属性 ${retiredHits.join('、')}，请更新代码后重新校验。`
            : '示例依赖了已删除属性。';
          issues.push({ id: `${component.id}-${example.id}-missing-ref`, level: 'error', componentId: component.id, target: example.title, message: detail, field: 'examples' });
        }
        if (example.stale) {
          issues.push({ id: `${component.id}-${example.id}-stale`, level: 'error', componentId: component.id, target: example.title, message: example.staleReason || '示例引用失效，需要修复后重新校验。', field: 'examples' });
        }
        if (example.needsConfirmation) {
          issues.push({ id: `${component.id}-${example.id}-confirm`, level: 'error', componentId: component.id, target: example.title, message: example.confirmReason || '键盘或读屏契约已变化，示例待确认。', field: 'examples' });
        }
        if (!example.code.trim()) {
          issues.push({ id: `${component.id}-${example.id}-empty`, level: 'error', componentId: component.id, target: example.title, message: '示例代码不能为空。', field: 'examples' });
        }
      });
      if (!component.keyboardBehavior.trim()) {
        issues.push({ id: `${component.id}-keyboard`, level: 'error', componentId: component.id, target: component.name, message: '缺少键盘行为说明。', field: 'keyboard' });
      }
      if (!component.screenReader.trim()) {
        issues.push({ id: `${component.id}-screenreader`, level: 'error', componentId: component.id, target: component.name, message: '缺少读屏说明。', field: 'screenReader' });
      }
      if (component.status === 'review' && !component.examples.length) {
        issues.push({ id: `${component.id}-no-examples`, level: 'warning', componentId: component.id, target: component.name, message: '待审组件还没有关联示例。', field: 'examples' });
      }
    }
    return issues;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.state));
    this.state = this.hydrate(previous);
    this.persist(false);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = this.hydrate(next);
    this.persist(false);
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist(false);
    this.emit();
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void, options: { clearHistory?: boolean } = {}) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    if (options.clearHistory) {
      this.undoStack = [];
    } else {
      this.undoStack.push(before);
      this.undoStack = this.undoStack.slice(-40);
    }
    this.redoStack = [];
    this.lastAction = label;
    this.state = this.hydrate(next);
    this.persist();
    this.emit();
  }

  private load(): WorkspaceState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as WorkspaceState;
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
    }
    return createInitialState();
  }

  /** 补齐旧版本存储中缺失的修订流程字段，保证刷新后草稿可继续处理。 */
  private hydrate(state: WorkspaceState): WorkspaceState {
    state.components.forEach((component) => {
      if (!Array.isArray(component.retiredPropertyNames)) component.retiredPropertyNames = [];
      component.examples.forEach((example) => {
        if (typeof example.needsConfirmation !== 'boolean') example.needsConfirmation = false;
        if (typeof example.confirmReason !== 'string') example.confirmReason = '';
        if (typeof example.staleReason !== 'string') example.staleReason = '';
      });
    });
    return state;
  }

  private persist(_notify = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}
