import { ResolumeClient } from "./resolume-client.js";
import { DashboardParam } from "./types.js";

interface DashboardAssignment {
  type: "dashboard";
  paramId: number;
  name: string;
  min: number;
  max: number;
  value: number;
  sensitivity?: number; // 1.0 = default; higher = faster sweep
}

interface LayerAssignment {
  type: "layer";
  layer: number;
  param: string;
  min: number;
  max: number;
  value: number;
  paramId?: number; // WS param ID — preferred over REST when available
  sensitivity?: number;
}

interface ClipAssignment {
  type: "clip";
  layer: number;
  clip: number;
  param: string;
  min: number;
  max: number;
  value: number;
  paramId?: number; // WS param ID — preferred over REST when available
  sensitivity?: number;
}

type DialAssignment = DashboardAssignment | LayerAssignment | ClipAssignment;

export interface AssignmentInfo {
  label: string;
  value: number;
  min: number;
  max: number;
}

export class KnobHandler {
  private readonly assignments = new Map<number, DialAssignment>();
  /** Called after any value change so callers can update the display. */
  onValueChanged: ((dialIndex: number, info: AssignmentInfo) => void) | null = null;

  constructor(private readonly client: ResolumeClient) {
    client.on("paramUpdate", ({ id, value }) => {
      this.assignments.forEach((a, dialIndex) => {
        if (a.type === "dashboard" && a.paramId === id) {
          a.value = value;
          this.emitChange(dialIndex, a);
        }
      });
    });
  }

  private emitChange(dialIndex: number, a: DialAssignment): void {
    if (!this.onValueChanged) return;
    this.onValueChanged(dialIndex, {
      label: this.labelFor(a),
      value: a.value,
      min: a.min,
      max: a.max,
    });
  }

  private labelFor(a: DialAssignment): string {
    if (a.type === "dashboard") return a.name;
    if (a.type === "layer") {
      const pretty: Record<string, string> = { opacity: "Opacity", speed: "Speed", volume: "Volume", transition_duration: "Trans. Time" };
      return `L${a.layer} ${pretty[a.param] ?? a.param}`;
    }
    const pretty: Record<string, string> = { opacity: "Opacity", speed: "Speed", volume: "Volume", position: "Scrub" };
    return `L${a.layer}C${a.clip} ${pretty[a.param] ?? a.param}`;
  }

  getInfo(dialIndex: number): AssignmentInfo | null {
    const a = this.assignments.get(dialIndex);
    if (!a) return null;
    return { label: this.labelFor(a), value: a.value, min: a.min, max: a.max };
  }

  assignDial(dialIndex: number, param: DashboardParam | null, sensitivity?: number): void {
    if (param === null) {
      this.assignments.delete(dialIndex);
    } else {
      this.assignments.set(dialIndex, {
        type: "dashboard",
        paramId: param.id,
        name: param.name,
        min: param.min,
        max: param.max,
        value: param.value,
        sensitivity,
      });
    }
  }

  assignDialToLayer(
    dialIndex: number,
    layer: number,
    param: string,
    currentValue: number,
    min = 0,
    max = param === "speed" ? 2 : 1,
    paramId?: number,
    sensitivity?: number,
  ): void {
    this.assignments.set(dialIndex, {
      type: "layer",
      layer,
      param,
      min,
      max,
      value: Math.max(min, Math.min(currentValue, max)),
      paramId,
      sensitivity,
    });
  }

  assignDialToClip(
    dialIndex: number,
    layer: number,
    clip: number,
    param: string,
    currentValue: number,
    min = 0,
    max = param === "speed" ? 2 : 1,
    paramId?: number,
    sensitivity?: number,
  ): void {
    this.assignments.set(dialIndex, {
      type: "clip",
      layer,
      clip,
      param,
      min,
      max,
      value: Math.max(min, Math.min(currentValue, max)),
      paramId,
      sensitivity,
    });
  }

  async onDialRotate(dialIndex: number, ticks: number): Promise<void> {
    const a = this.assignments.get(dialIndex);
    if (!a) return;

    const sens = a.sensitivity && a.sensitivity > 0 ? a.sensitivity : 1;
    const step = ((a.max - a.min) / 20) * sens;
    const newValue = Math.max(a.min, Math.min(a.max, a.value + ticks * step));
    a.value = newValue;

    if (a.type === "dashboard") {
      console.log(`[knob] dial ${dialIndex} dashboard param ${a.paramId} → ${newValue.toFixed(3)}`);
      this.client.setParameterById(a.paramId, newValue);
    } else if (a.type === "layer") {
      if (a.paramId !== undefined) {
        console.log(`[knob] dial ${dialIndex} layer ${a.layer} ${a.param} via WS id=${a.paramId} → ${newValue.toFixed(3)}`);
        this.client.setParameterById(a.paramId, newValue);
      } else {
        console.log(`[knob] dial ${dialIndex} layer ${a.layer} ${a.param} via REST → ${newValue.toFixed(3)}`);
        await this.client.setLayerParam(a.layer, a.param, newValue).catch((err) =>
          console.error("[knob] setLayerParam error:", err)
        );
      }
    } else {
      if (a.paramId !== undefined) {
        console.log(`[knob] dial ${dialIndex} clip ${a.layer}:${a.clip} ${a.param} via WS id=${a.paramId} → ${newValue.toFixed(3)}`);
        this.client.setParameterById(a.paramId, newValue);
      } else {
        console.log(`[knob] dial ${dialIndex} clip ${a.layer}:${a.clip} ${a.param} via REST → ${newValue.toFixed(3)}`);
        await this.client.setClipParam(a.layer, a.clip, a.param, newValue).catch((err) =>
          console.error("[knob] setClipParam error:", err)
        );
      }
    }
    this.emitChange(dialIndex, a);
  }

  async onDialPress(dialIndex: number): Promise<void> {
    const a = this.assignments.get(dialIndex);
    if (!a) return;

    if (a.type === "dashboard") {
      this.client.resetParameterById(a.paramId);
    } else if (a.type === "layer") {
      const resetVal = a.param === "speed" ? 1 : (a.param === "volume" ? 1 : 1);
      if (a.paramId !== undefined) {
        this.client.setParameterById(a.paramId, resetVal);
      } else {
        await this.client.setLayerParam(a.layer, a.param, resetVal).catch(() => {});
      }
      a.value = resetVal;
      this.emitChange(dialIndex, a);
    } else {
      const resetVal = a.param === "speed" ? 1 : (a.param === "position" ? 0 : 1);
      if (a.paramId !== undefined) {
        this.client.setParameterById(a.paramId, resetVal);
      } else {
        await this.client.setClipParam(a.layer, a.clip, a.param, resetVal).catch(() => {});
      }
      a.value = resetVal;
      this.emitChange(dialIndex, a);
    }
  }
}
