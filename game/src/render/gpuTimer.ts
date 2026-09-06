/** Nonblocking WebGL2 timings. Never read a query result before availability is reported. */
export class GpuTimer {
  private readonly extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private frame = 0;
  private milliseconds: number | null = null;
  private completed = 0;

  constructor(private readonly gl: WebGL2RenderingContext,
    private readonly intervalFrames = 10, private readonly phase = 0) {
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  begin(): void {
    const ext = this.extension;
    if (!ext || this.active) return;
    if (this.gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const query of this.pending) this.gl.deleteQuery(query);
      this.pending = [];
      this.milliseconds = null;
      return;
    }
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0]!, this.gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      const ns = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
      this.gl.deleteQuery(query);
      if (Number.isFinite(ns) && ns >= 0) { this.milliseconds = ns / 1e6; this.completed++; }
    }
    // Bound driver resources and sample the requested cadence without synchronizing the GPU.
    if (this.frame++ % this.intervalFrames !== this.phase || this.pending.length >= 4) return;
    // Other diagnostic renderers may own the same elapsed-query target. Never nest queries.
    if (this.gl.getQuery?.(ext.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY)) return;
    this.active = this.gl.createQuery();
    if (this.active) this.gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }

  end(): void {
    if (!this.extension || !this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  snapshot(): { supported: boolean; milliseconds: number | null; completed: number; pending: number } {
    return { supported: this.extension !== null, milliseconds: this.milliseconds, completed: this.completed, pending: this.pending.length };
  }

  dispose(): void {
    this.end();
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }
}
