import { describe, expect, it } from "vitest";
import { TaskEventBus } from "./event-bus.js";

describe("TaskEventBus", () => {
    it("delivers live events to subscribers", () => {
        const bus = new TaskEventBus();
        const received: string[] = [];
        const unsubscribe = bus.subscribe("t1", (event) => received.push(event.type), {
            replay: false,
        });
        bus.publish("t1", { type: "task.running", task: null as never });
        expect(received).toEqual(["task.running"]);
        unsubscribe();
        bus.publish("t1", { type: "task.succeeded", task: null as never });
        expect(received).toEqual(["task.running"]);
    });

    it("replays recent events on subscribe", () => {
        const bus = new TaskEventBus();
        bus.publish("t1", { type: "task.queued", task: null as never, timestamp: 1 });
        const received: string[] = [];
        bus.subscribe("t1", (event) => received.push(event.type));
        expect(received).toEqual(["task.queued"]);
    });

    it("skips replay when disabled", () => {
        const bus = new TaskEventBus();
        bus.publish("t1", { type: "task.queued", task: null as never, timestamp: 1 });
        const received: string[] = [];
        bus.subscribe("t1", (event) => received.push(event.type), { replay: false });
        expect(received).toEqual([]);
    });

    it("tracks listeners and supports clearing history", () => {
        const bus = new TaskEventBus();
        expect(bus.hasListeners("t1")).toBe(false);
        const unsubscribe = bus.subscribe("t1", () => undefined, { replay: false });
        expect(bus.hasListeners("t1")).toBe(true);
        unsubscribe();
        expect(bus.hasListeners("t1")).toBe(false);
        bus.clear("t1");
        const replayed: string[] = [];
        bus.subscribe("t1", (event) => replayed.push(event.type));
        expect(replayed).toEqual([]);
    });
});
