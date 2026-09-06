/** Switch scatter only after the semantic renderer has created or released its replacement. */
export class ForestPresentation {
  private readonly instances = new Map<string, (visible: boolean) => void>();
  private readonly transitions = new Map<string, { resident: boolean; depleted: boolean }>();

  register(id: string, setVisible: (visible: boolean) => void): void {
    this.instances.set(id, setVisible);
    if (this.transitions.get(id)?.depleted) setVisible(false);
  }

  activate(id: string, depleted: boolean): void {
    const previous = this.transitions.get(id);
    if (previous?.resident && previous.depleted === depleted) return;
    this.transitions.set(id, { resident: true, depleted });
    // Saved stumps must never briefly regrow while their asset loads.
    if (depleted) this.instances.get(id)?.(false);
  }

  deactivate(id: string): void {
    this.transitions.set(id, { resident: false, depleted: false });
  }

  reconcile(hasView: (id: string) => boolean): void {
    for (const [id, state] of this.transitions) {
      const drawn = hasView(id);
      this.instances.get(id)?.(!drawn && !state.depleted);
      if (!state.resident && !drawn) this.transitions.delete(id);
    }
  }
}
