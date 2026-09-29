export type ComponentStatus = 'draft' | 'review' | 'published';
export type PreviewTheme = 'light' | 'dark';
export type PreviewDensity = 'compact' | 'regular' | 'spacious';

export interface PropertySpec {
  id: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

export interface ComponentExample {
  id: string;
  title: string;
  code: string;
  propertyIds: string[];
  /** 引用失效：依赖的属性被删除，或代码中仍出现已退役属性名。必须修复后才能发布。 */
  stale: boolean;
  staleReason: string;
  /** 待确认：键盘行为、读屏说明或交互签名变化后，需要人工逐条确认示例仍成立。 */
  needsConfirmation: boolean;
  confirmReason: string;
  createdFromRevision: number;
}

export interface ComponentSpec {
  id: string;
  name: string;
  category: string;
  status: ComponentStatus;
  purpose: string;
  usage: string;
  properties: PropertySpec[];
  states: string;
  keyboardBehavior: string;
  screenReader: string;
  disabledScenarios: string;
  interactionSignature: string;
  examples: ComponentExample[];
  revision: number;
  updatedAt: string;
  snapshots: ComponentSnapshot[];
  /** 已删除的属性名（墓碑），用于检测示例代码里是否仍引用旧属性。 */
  retiredPropertyNames: string[];
  /** 仅修订草稿：所修订的已发布组件 id。 */
  revisionOfId?: string;
  /** 仅已发布组件：当前进行中的修订草稿 id（同时只允许一个）。 */
  draftId?: string;
}

export interface ComponentSnapshot {
  revision: number;
  savedAt: string;
  reason: string;
  component: Omit<ComponentSpec, 'snapshots'>;
}

export interface WorkspaceState {
  components: ComponentSpec[];
  selectedId: string;
}

export interface ValidationIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  componentId: string;
  target: string;
  message: string;
  field: 'properties' | 'examples' | 'keyboard' | 'screenReader';
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}

export interface PublishOutcome {
  ok: boolean;
  reasons: string[];
  revision?: number;
}
