import { EventEmitter } from "node:events";
import type { TaskStreamEvent } from "./types.js";

const MAX_RECENT_EVENTS = 200;

export class TaskEventBus {
    private readonly emitter = new EventEmitter();
    private readonly recent = new Map<string, TaskStreamEvent[]>();

    constructor() {
        this.emitter.setMaxListeners(0);
    }

    publish(taskId: string, event: TaskStreamEvent): void {
        const list = this.recent.get(taskId) ?? [];
        list.push(event);
        if (list.length > MAX_RECENT_EVENTS) {
            list.splice(0, list.length - MAX_RECENT_EVENTS);
        }
        this.recent.set(taskId, list);
        this.emitter.emit(taskId, event);
    }

    subscribe(
        taskId: string,
        handler: (event: TaskStreamEvent) => void,
        options: { replay?: boolean } = {},
    ): () => void {
        if (options.replay !== false) {
            for (const event of this.recent.get(taskId) ?? []) {
                handler(event);
            }
        }
        this.emitter.on(taskId, handler);
        return () => {
            this.emitter.off(taskId, handler);
        };
    }

    hasListeners(taskId: string): boolean {
        return this.emitter.listenerCount(taskId) > 0;
    }

    clear(taskId: string): void {
        this.recent.delete(taskId);
    }
}

export const taskEventBus = new TaskEventBus();
