/**
 * Tracks hover, selection, and focus-path state.
 * Emits change events so the renderer re-draws only when state changes.
 */
export class SelectionModel {
  constructor() {
    this._hovered  = null;    // nodeId | null
    this._selected = new Set();
    this._focused  = null;    // nodeId | null — drives focus path / isolation
    this._listeners = [];
  }

  onChanged(cb) {
    this._listeners.push(cb);
    return () => { this._listeners = this._listeners.filter(l => l !== cb); };
  }

  _emit() {
    for (const cb of this._listeners) cb(this.snapshot());
  }

  setHovered(nodeId) {
    if (this._hovered === nodeId) return;
    this._hovered = nodeId;
    this._emit();
  }

  toggleSelected(nodeId) {
    if (this._selected.has(nodeId)) this._selected.delete(nodeId);
    else this._selected.add(nodeId);
    this._emit();
  }

  setFocused(nodeId) {
    this._focused = this._focused === nodeId ? null : nodeId;
    this._emit();
  }

  clear() {
    this._hovered = null;
    this._selected.clear();
    this._focused = null;
    this._emit();
  }

  isHovered(nodeId)  { return this._hovered === nodeId; }
  isSelected(nodeId) { return this._selected.has(nodeId); }
  isFocused(nodeId)  { return this._focused === nodeId; }

  get hoveredId()  { return this._hovered; }
  get focusedId()  { return this._focused; }
  get selectedIds(){ return [...this._selected]; }

  snapshot() {
    return {
      hovered:  this._hovered,
      selected: [...this._selected],
      focused:  this._focused,
    };
  }
}
