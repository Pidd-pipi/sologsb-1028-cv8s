import { createInitialState } from './data';
import type { ComponentSnapshot, ComponentSpec, ValidationIssue, WorkspaceState } from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v1';
const MAX_SNAPSHOTS = 12;

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 以组件当前内容生成一份不可变快照（不含快照列表与修订关联）。 */
const snapshotOf = (component: ComponentSpec, reason: string, savedAt: string): ComponentSnapshot => {
  const { snapshots: _snapshots, revisionOfId: _revisionOfId, ...body } = clone(component);
  return { revision: component.revision, savedAt, reason, component: body };
};

interface Inspection {
  level: 'error' | 'warning' | 'info';
  target: string;
  message: string;
  field: ValidationIssue['field'];
}

export class SpecStore extends EventTarget {
  state: WorkspaceState;
  private undoStack: WorkspaceState[] = [];
  private redoStack: WorkspaceState[] = [];
  private lastAction = '';

  constructor() {
    super();
    this.state = this.load();
  }

  get selected(): ComponentSpec | undefined {
    return this.state.components.find((item) => item.id === this.state.selectedId);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastUndoLabel() { return this.lastAction; }

  isReadonly(id: string): boolean {
    return this.state.components.find((item) => item.id === id)?.status === 'published';
  }

  /** 修订草稿对应的原已发布组件（用于读取冻结快照与差异基线）。 */
  publishedParentOf(component: ComponentSpec): ComponentSpec | undefined {
    return component.revisionOfId
      ? this.state.components.find((item) => item.id === component.revisionOfId && item.status === 'published')
      : undefined;
  }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist();
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
      snapshots: []
    };
    this.commit('新建组件', (state) => {
      state.components.unshift(component);
      state.selectedId = id;
    });
  }

  /**
   * 已发布组件只读：点“创建修订”把当前发布版完整复制成待审草稿。
   * 同一发布版若已有草稿，则直接回到该草稿，刷新页面后仍可继续处理。
   */
  createRevision(): 'created' | 'existing' | undefined {
    const selected = this.selected;
    if (!selected || selected.status !== 'published') return undefined;
    const existing = this.state.components.find((item) => item.revisionOfId === selected.id);
    if (existing) {
      this.select(existing.id);
      return 'existing';
    }
    this.commit('创建修订', (state) => {
      const published = state.components.find((item) => item.id === selected.id);
      if (!published) return;
      const draft = clone(published);
      draft.id = uid('component');
      draft.revisionOfId = published.id;
      draft.status = 'review';
      draft.snapshots = [];
      draft.updatedAt = new Date().toISOString();
      draft.examples.forEach((example) => {
        example.stale = false;
        example.staleReason = '';
      });
      state.components.unshift(draft);
      state.selectedId = draft.id;
    });
    return 'created';
  }

  /** 放弃修订草稿，原发布版与全部快照保持不变。 */
  discardRevision() {
    const selected = this.selected;
    if (!selected?.revisionOfId) return;
    const parentId = selected.revisionOfId;
    this.commit('放弃修订', (state) => {
      state.components = state.components.filter((item) => item.id !== selected.id);
      state.selectedId = parentId;
    });
  }

  updateComponent(patch: Partial<ComponentSpec>) {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
    const staleReasons: string[] = [];
    if (patch.keyboardBehavior !== undefined && patch.keyboardBehavior !== selected.keyboardBehavior) {
      staleReasons.push('键盘行为说明已变化');
    }
    if (patch.screenReader !== undefined && patch.screenReader !== selected.screenReader) {
      staleReasons.push('读屏说明已变化');
    }
    if (patch.interactionSignature !== undefined && patch.interactionSignature !== selected.interactionSignature) {
      staleReasons.push('交互签名已变化');
    }
    this.commit('编辑组件', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      // 键盘/读屏（含交互签名）变化无法自动判断示例是否成立：所有关联示例一律待确认。
      if (staleReasons.length) {
        const reason = `${staleReasons.join('、')}，请逐例确认示例仍然成立。`;
        target.examples.forEach((example) => {
          example.stale = true;
          example.staleReason = reason;
        });
      }
    });
  }

  addProperty() {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
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
   * 属性改名：仅同步更新显式引用该属性（依赖勾选或代码中出现旧名）的示例代码，
   * 其他示例原样保留。返回被更新的示例数量。
   */
  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>): number {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return 0;
    let updatedExamples = 0;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      if (patch.name !== undefined && patch.name.trim() && patch.name !== property.name) {
        const oldName = property.name;
        const referencePattern = new RegExp(`\\b${escapeRegExp(oldName)}\\b`);
        const replacePattern = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'g');
        for (const example of target.examples) {
          // 与删除属性一致：显式依赖或代码中出现旧名，都视为引用该属性的示例。
          if (!example.propertyIds.includes(propertyId) && !referencePattern.test(example.code)) continue;
          const nextCode = example.code.replaceAll(replacePattern, patch.name);
          if (nextCode !== example.code) {
            example.code = nextCode;
            updatedExamples += 1;
          }
        }
      }
      Object.assign(property, patch);
    });
    return updatedExamples;
  }

  removeProperty(propertyId: string) {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
    this.commit('删除属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      target.properties = target.properties.filter((item) => item.id !== propertyId);
      target.examples.forEach((example) => {
        if (example.propertyIds.includes(propertyId) || example.code.includes(property.name)) {
          example.stale = true;
          example.staleReason = `属性 ${property.name} 已删除，请确认示例代码或说明中的引用。`;
        }
      });
    });
  }

  addExample() {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
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
        createdFromRevision: target.revision
      });
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
    this.commit('编辑示例', (state) => {
      const example = state.components.find((item) => item.id === selected.id)?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) target.examples = target.examples.filter((item) => item.id !== exampleId);
    });
  }

  /** 维护者逐例确认：清理已失效的属性引用并解除待确认标记。 */
  confirmExample(exampleId: string) {
    const selected = this.selected;
    if (!selected || this.isReadonly(selected.id)) return;
    this.commit('确认示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (!target || !example) return;
      const activePropertyIds = new Set(target.properties.map((property) => property.id));
      example.propertyIds = example.propertyIds.filter((id) => activePropertyIds.has(id));
      example.stale = false;
      example.staleReason = '';
    });
  }

  /** 发布前阻断项：规范错误或存在待确认示例时均不能发布。 */
  publishBlockers(): string[] {
    return this.selected ? this.inspect(this.selected).filter((item) => item.level === 'error').map((item) => item.message) : [];
  }

  /**
   * 发布：仅在校验全部通过后执行。
   * 修订草稿发布时，原发布版先保留旧快照，再冻结新快照；随后草稿被删除，
   * 页面选中更新后的发布版。发布失败时不产生任何快照或数据变化。
   */
  publishComponent(): { ok: boolean; reason?: string } {
    const selected = this.selected;
    if (!selected) return { ok: false, reason: '未选择组件。' };
    if (selected.status === 'published') return { ok: false, reason: '已发布组件只读，请先创建修订。' };
    const blockers = this.publishBlockers();
    if (blockers.length) return { ok: false, reason: blockers[0] };

    let outcome: { ok: boolean; reason?: string } = { ok: true };
    this.commit('发布规范', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) {
        outcome = { ok: false, reason: '未找到待发布组件。' };
        return;
      }
      const recheck = this.inspect(target).filter((item) => item.level === 'error');
      if (recheck.length) {
        outcome = { ok: false, reason: recheck[0].message };
        return;
      }
      const savedAt = new Date().toISOString();
      const parent = target.revisionOfId
        ? state.components.find((item) => item.id === target.revisionOfId && item.status === 'published')
        : undefined;

      if (parent) {
        // 旧发布版缺少同版快照（旧数据）时先补齐，确保每个发布版本都可追溯。
        if (!parent.snapshots.some((snapshot) => snapshot.revision === parent.revision)) {
          parent.snapshots.unshift(snapshotOf(parent, `发布 r${parent.revision}`, parent.updatedAt));
        }
        const nextRevision = parent.revision + 1;
        const { id: _draftId, revisionOfId: _parentRef, snapshots: _draftSnapshots, ...draftBody } = target;
        // 只把草稿的规范正文并入发布版；发布版 id 与历史快照保持不变。
        Object.assign(parent, draftBody, { id: parent.id, revisionOfId: undefined, snapshots: parent.snapshots });
        parent.revision = nextRevision;
        parent.status = 'published';
        parent.updatedAt = savedAt;
        parent.examples.forEach((example) => {
          example.stale = false;
          example.staleReason = '';
          example.createdFromRevision = nextRevision;
        });
        parent.snapshots.unshift(snapshotOf(parent, `发布 r${nextRevision}`, savedAt));
        parent.snapshots = parent.snapshots.slice(0, MAX_SNAPSHOTS);
        state.components = state.components.filter((item) => item.id !== target.id);
        state.selectedId = parent.id;
      } else {
        target.status = 'published';
        target.revision = Math.max(1, target.revision);
        target.updatedAt = savedAt;
        target.examples.forEach((example) => {
          example.stale = false;
          example.staleReason = '';
          example.createdFromRevision = target.revision;
        });
        target.snapshots.unshift(snapshotOf(target, `发布 r${target.revision}`, savedAt));
        target.snapshots = target.snapshots.slice(0, MAX_SNAPSHOTS);
      }
    });
    return outcome;
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const component of this.state.components) {
      for (const item of this.inspect(component)) {
        issues.push({ id: `${component.id}-${item.field}-${issues.length}`, level: item.level, componentId: component.id, target: item.target, message: item.message, field: item.field });
      }
    }
    return issues;
  }

  private inspect(component: ComponentSpec): Inspection[] {
    const findings: Inspection[] = [];
    if (!component.name.trim()) {
      findings.push({ level: 'error', target: component.name || '未命名组件', message: '组件名称不能为空。', field: 'properties' });
    }
    const names = new Map<string, number>();
    component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
    for (const [name, count] of names) {
      if (!name) {
        findings.push({ level: 'error', target: component.name, message: '存在未命名属性。', field: 'properties' });
      } else if (count > 1) {
        findings.push({ level: 'error', target: component.name, message: `属性名称 ${name} 重复。`, field: 'properties' });
      }
    }
    if (!component.keyboardBehavior.trim()) {
      findings.push({ level: 'error', target: component.name, message: '缺少键盘行为说明。', field: 'keyboard' });
    }
    if (!component.screenReader.trim()) {
      findings.push({ level: 'error', target: component.name, message: '缺少读屏说明。', field: 'screenReader' });
    }
    component.examples.forEach((example) => {
      const missingReferences = example.propertyIds.filter((id) => !component.properties.some((property) => property.id === id));
      if (example.stale) {
        findings.push({ level: 'error', target: example.title, message: example.staleReason || '示例仍待确认，发布前请逐例核对。', field: 'examples' });
      }
      if (missingReferences.length) {
        findings.push({ level: 'error', target: example.title, message: '示例引用了已删除属性，请清理依赖或确认示例。', field: 'examples' });
      }
      if (!example.code.trim()) {
        findings.push({ level: 'error', target: example.title, message: '示例代码不能为空。', field: 'examples' });
      }
    });
    return findings;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.state));
    this.state = previous;
    this.persist();
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = next;
    this.persist();
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist();
    this.emit();
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.lastAction = label;
    this.state = next;
    this.persist();
    this.emit();
  }

  private load(): WorkspaceState {
    let state: WorkspaceState;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      state = saved ? (JSON.parse(saved) as WorkspaceState) : createInitialState();
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
      state = createInitialState();
    }
    for (const component of state.components) {
      // 已发布组件必须保留与当前版本一致的冻结快照；旧版本数据缺失时就地补齐。
      if (component.status === 'published' && !component.snapshots.some((snapshot) => snapshot.revision === component.revision)) {
        component.snapshots.unshift(snapshotOf(component, `发布 r${component.revision}`, component.updatedAt));
      }
    }
    if (!state.components.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.components[0]?.id ?? '';
    }
    return state;
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}
